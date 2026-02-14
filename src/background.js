/**
 * Domain Tab Grouper - Background Script
 */

console.log("Tab Grouper Background Script Loaded (v2.2)");

const DEFAULT_SETTINGS = {
  autoGroup: true,
  excludedDomains: [],
  autoCollapse: false,
  removeDuplicates: false,
  sortAlphabetically: false,
  customRules: [],
};

// メモリキャッシュ用の変数
let cachedSettings = null;

// 設定を読み込んでキャッシュを更新する
async function updateCache() {
  const result = await chrome.storage.local.get(["settings"]);
  cachedSettings = result.settings || DEFAULT_SETTINGS;
}

// 初期化およびストレージ監視
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(["settings"]);
  if (!result.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    cachedSettings = DEFAULT_SETTINGS;
  } else {
    cachedSettings = result.settings;
  }
});

// サービスワーカー起動時にもキャッシュを初期化
updateCache();

// ストレージの変更を監視してキャッシュを同期する (軽量化・整合性維持)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    cachedSettings = changes.settings.newValue;
  }
});

/**
 * URLからドメインを抽出し、コンパクトな表示名を生成する
 */
function getGroupName(url) {
  try {
    const urlObj = new URL(url);
    if (
      urlObj.protocol === "chrome:" ||
      urlObj.protocol === "chrome-extension:"
    )
      return null;

    const hostname = urlObj.hostname;

    const parts = hostname.split(".");

    // IPアドレスの場合はそのまま返す
    if (parts.every((part) => !isNaN(part))) {
      return hostname;
    }

    // 一般的なセカンドレベルドメイン (SLD) のリスト
    // 必要に応じて追加してください
    const compoundTLDs = [
      "co.jp",
      "ne.jp",
      "or.jp",
      "go.jp",
      "ac.jp",
      "ad.jp",
      "ed.jp",
      "gr.jp",
      "lg.jp", // 日本
      "co.uk",
      "org.uk",
      "me.uk",
      "ltd.uk", // イギリス
      "com.au",
      "net.au",
      "org.au", // オーストラリア
      "com.br",
      "net.br", // ブラジル
      "com.cn",
      "net.cn",
      "org.cn", // 中国
      "co.nz",
      "net.nz",
      "org.nz", // ニュージーランド
      // その他必要に応じて追加
    ];

    // 末尾が compoundTLD に一致するかチェック
    const isCompound = compoundTLDs.some((tld) => hostname.endsWith("." + tld));
    const domainParts = isCompound ? 3 : 2;

    if (parts.length >= domainParts) {
      return parts[parts.length - domainParts];
    }

    return hostname;
  } catch (e) {
    return null;
  }
}

/**
 * URLがルールパターンに一致するか判定する
 * パス区切り文字(/)がない場合は、ドメインとしての厳密な一致（完全一致またはサブドメイン）をチェックする
 */
function isUrlMatch(url, pattern) {
  // パスが含まれる場合は既存の部分一致を使用
  if (pattern.includes("/")) {
    return url.includes(pattern);
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    // ホスト名が完全に一致するか、サブドメインとして一致するか (.pattern で終わる)
    return hostname === pattern || hostname.endsWith("." + pattern);
  } catch (e) {
    // URL解析に失敗した場合は念のため部分一致に戻す
    return url.includes(pattern);
  }
}

/**
 * 同じタイトルのグループを統合する
 * @param {number} windowId - ウィンドウID
 */
async function consolidateGroups(windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const groupsByTitle = new Map();

    // タイトルごとにグループを分類
    for (const group of groups) {
      if (!group.title) continue;

      if (!groupsByTitle.has(group.title)) {
        groupsByTitle.set(group.title, []);
      }
      groupsByTitle.get(group.title).push(group);
    }

    // 重複しているタイトルのグループを統合
    for (const [title, groupList] of groupsByTitle.entries()) {
      if (groupList.length > 1) {
        // 最初のグループを保持し、他のグループのタブを移動
        const primaryGroup = groupList[0];

        for (let i = 1; i < groupList.length; i++) {
          const duplicateGroup = groupList[i];

          // 重複グループのタブを取得
          const tabs = await chrome.tabs.query({ groupId: duplicateGroup.id });

          if (tabs.length > 0) {
            // タブを主グループに移動
            const tabIds = tabs.map((t) => t.id);
            await chrome.tabs.group({ tabIds, groupId: primaryGroup.id });
          }
        }
      }
    }
  } catch (err) {
    // エラーは無視（グループが既に削除されている場合など）
  }
}

/**
 * タブをドメインまたはカスタムルールに基づいてグループ化する
 */
async function groupTab(tab) {
  try {
    if (!cachedSettings) await updateCache();
    if (!cachedSettings.autoGroup) return;

    const url = tab.url;
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      return;
    }
    const domain = urlObj.hostname;

    // 除外ドメインの場合は、すでにグループ化されていればグループ解除する
    if (cachedSettings.excludedDomains.includes(domain)) {
      if (tab.groupId !== -1) {
        try {
          await chrome.tabs.ungroup(tab.id);
        } catch (e) {
          // Ignore error
        }
      }
      return;
    }

    let groupTitle = "";
    let groupColor = null;

    // 1. カスタムルールのチェック (URLパスを含む詳細一致を優先)
    if (cachedSettings.customRules) {
      // パターンが長い順にソートして、より詳細な一致を優先する
      const sortedRules = [...cachedSettings.customRules].sort(
        (a, b) => b.pattern.length - a.pattern.length,
      );
      for (const rule of sortedRules) {
        if (isUrlMatch(url, rule.pattern)) {
          groupTitle = rule.name;
          groupColor = rule.color;
          break;
        }
      }
    }

    // 2. 自動グループ化 (ドメインベース)
    if (!groupTitle) {
      groupTitle = getGroupName(url);
    }

    // グループ名が決まらなかった場合（システムページなど）、グループ解除する
    if (!groupTitle) {
      if (tab.groupId !== -1) {
        try {
          await chrome.tabs.ungroup(tab.id);
        } catch (e) {
          // タブが既に閉じられている場合など、エラーは無視する
        }
      }
      return;
    }

    // すでに正しいグループに属しているか確認
    if (tab.groupId !== -1) {
      try {
        const currentGroup = await chrome.tabGroups.get(tab.groupId);
        if (currentGroup.title === groupTitle) {
          return; // すでに正しいグループにいる
        }
      } catch (e) {
        // グループ情報の取得に失敗した場合（グループが存在しないなど）は続行
      }
    }

    // 同じウィンドウ内で重複グループを統合
    await consolidateGroups(tab.windowId);
    
    // 同じウィンドウ内で同じ名前のグループを探す
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const existingGroup = groups.find((g) => g.title === groupTitle);

    if (existingGroup) {
      await chrome.tabs.group({ tabIds: tab.id, groupId: existingGroup.id });
    } else {
      // 新しいグループを作成
      const groupId = await chrome.tabs.group({ tabIds: tab.id });
      const updateOptions = {
        title: groupTitle,
        collapsed: cachedSettings.autoCollapse,
      };
      if (groupColor) {
        updateOptions.color = groupColor;
      }
      await chrome.tabGroups.update(groupId, updateOptions);
    }

    // 重複タブの削除設定がONの場合
    if (cachedSettings.removeDuplicates) {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      const duplicates = tabs.filter(
        (t) => t.url === tab.url && t.id !== tab.id,
      );
      if (duplicates.length > 0) {
        const idsToRemove = duplicates.map((t) => t.id);
        await chrome.tabs.remove(idsToRemove);
      }
    }
  } catch (err) {
    // 競合状態やタブドラッグ中のエラー("Tabs cannot be edited right now")などを全面的に無視する
  }
}

// タブ更新時のイベント (statusがcompleteまたはURL変更時)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // changeInfo.url がある場合または status が complete の場合のみ実行
  if ((changeInfo.status === "complete" || changeInfo.url) && tab.url) {
    groupTab(tab).catch(() => {});
  }
});

// 外部からのグループ化要求（ポップアップなどから）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "organizeAll") {
    organizeAllTabs().then(() => sendResponse({ status: "done" }));
    return true;
  }
});

/**
 * タブをアルファベット順（グループ名 -> タブタイトル）に並べ替える
 */
async function sortTabs(windowId) {
  if (!cachedSettings || !cachedSettings.sortAlphabetically) return;

  try {
    const tabs = await chrome.tabs.query({ windowId });
    const groups = await chrome.tabGroups.query({ windowId });
    const groupMap = new Map(groups.map(g => [g.id, g]));

    // 並べ替えロジック
    // 1. グループ名を優先 (グループなしは末尾)
    // 2. グループ内ではタブタイトル
    const sortedTabs = [...tabs].sort((a, b) => {
      const groupA = groupMap.get(a.groupId);
      const groupB = groupMap.get(b.groupId);
      const titleA = (groupA?.title || "ー").toLowerCase(); // グループなしを後ろにするための工夫
      const titleB = (groupB?.title || "ー").toLowerCase();

      if (titleA < titleB) return -1;
      if (titleA > titleB) return 1;

      // 同じグループ内、または両方グループなしの場合、タブタイトルで比較
      const tabTitleA = (a.title || "").toLowerCase();
      const tabTitleB = (b.title || "").toLowerCase();
      if (tabTitleA < tabTitleB) return -1;
      if (tabTitleA > tabTitleB) return 1;
      return 0;
    });

    // タブを移動
    for (let i = 0; i < sortedTabs.length; i++) {
        try {
            await chrome.tabs.move(sortedTabs[i].id, { index: i });
        } catch (e) {
            // タブが移動できない（ドラッグ中など）場合はスキップ
        }
    }
  } catch (err) {
    console.error("Sort tabs error:", err);
  }
}

/**
 * 全てのタブを現在の設定に基づいて再整理する
 */
async function organizeAllTabs() {
  if (!cachedSettings) await updateCache();
  const windows = await chrome.windows.getAll({ populate: true });
  
  // まず各ウィンドウの重複グループを統合
  for (const win of windows) {
    await consolidateGroups(win.id);
  }
  
  // 次に全タブをグループ化
  for (const win of windows) {
    // まず各タブをグループ化
    for (const tab of win.tabs) {
      await groupTab(tab);
    }
    // 設定が有効な場合は並べ替え
    if (cachedSettings.sortAlphabetically) {
        await sortTabs(win.id);
    }
  }
}
