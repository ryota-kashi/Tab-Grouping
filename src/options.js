const domainInput = document.getElementById("domainInput");
const addDomainBtn = document.getElementById("addDomain");
const exclusionList = document.getElementById("exclusionList");
const autoCollapse = document.getElementById("autoCollapse");
const removeDuplicates = document.getElementById("removeDuplicates");
const sortAlphabetically = document.getElementById("sortAlphabetically");

const DEFAULT_SETTINGS = {
  autoGroup: true,
  excludedDomains: [],
  autoCollapse: false,
  removeDuplicates: false,
  sortAlphabetically: false,
  customRules: [],
};

const rulePattern = document.getElementById("rulePattern");
const ruleName = document.getElementById("ruleName");
const ruleColor = document.getElementById("ruleColor");
const addRuleBtn = document.getElementById("addRule");
const ruleList = document.getElementById("ruleList");
const exportRulesBtn = document.getElementById("exportRules");
const importRulesBtn = document.getElementById("importRules");
const importFile = document.getElementById("importFile");
const cancelEditBtn = document.getElementById("cancelEdit");

let editingIndex = null;
let dragStartIndex = null;

// 設定の読み込みと表示
async function loadSettings() {
  const data = await chrome.storage.local.get(["settings"]);
  const settings = data.settings || DEFAULT_SETTINGS;

  autoCollapse.checked = settings.autoCollapse;
  removeDuplicates.checked = settings.removeDuplicates;
  sortAlphabetically.checked = settings.sortAlphabetically || false;

  renderExclusionList(settings.excludedDomains);
  renderRuleList(settings.customRules || []);
}

// 除外リストの描画
function renderExclusionList(domains) {
  exclusionList.innerHTML = "";
  domains.forEach((domain) => {
    const li = document.createElement("li");
    li.className = "exclusion-item";
    li.innerHTML = `
            <span>${domain}</span>
            <span class="btn-remove" data-domain="${domain}">削除</span>
        `;
    exclusionList.appendChild(li);
  });
}

// カスタムルールリストの描画 (フラットリスト)
function renderRuleList(rules) {
  ruleList.innerHTML = "";
  
  // Flatten rules just in case there are leftover folder structures, or just ignore folders?
  // Let's filter out any 'folder' types to be safe and only show rules.
  // Or simpler: Just render them. If user had folders, they might look weird or be hidden if I don't flatten.
  // Assuming we want to migrate everything to flat. 
  
  const flatRules = [];
  const flatten = (items) => {
      items.forEach(item => {
          if (item.type === 'folder') {
              if (item.children) flatten(item.children);
          } else {
              flatRules.push(item);
          }
      });
  };
  // If rules have no type (old data), they are rules.
  // If they have type 'rule', they are rules.
  // If 'folder', flatten.
  
  // To avoid modifying 'rules' in place during render loop, let's just render what we have.
  // But if we want to "abolish" folders, we should probably flatten the view.
  // However, updating settings would be needed to persist the flattening.
  // For now, let's just render the top level rules and if there are folders, maybe we should ignore or flatten?
  // User said "abolish", implying they don't want to use it.
  // Let's flatten visually.
  
  flatten(rules);
  
  // NOTE: If we flatten here for display, drag and drop will be messed up unless we also save the flattened list.
  // Ideally, we should migrate the data once.
  // But strictly speaking, let's just render the rules.
  
  flatRules.forEach((rule, index) => {
    const li = document.createElement("li");
    li.className = "exclusion-item";
    li.draggable = true;
    li.dataset.index = index;
    
    // Drag events
    li.addEventListener("dragstart", handleDragStart);
    li.addEventListener("dragover", handleDragOver);
    li.addEventListener("drop", handleDrop);
    li.addEventListener("dragend", handleDragEnd);
    li.addEventListener("dragleave", handleDragLeave);

    const contentDiv = document.createElement("div");
    contentDiv.className = "rule-content";

    const dragHandle = document.createElement("span");
    dragHandle.className = "drag-handle";
    dragHandle.title = "ドラッグして並び替え";
    dragHandle.textContent = "☰";
    contentDiv.appendChild(dragHandle);

    const colorDot = document.createElement("span");
    colorDot.className = "rule-color-dot";
    colorDot.style.color = rule.color === "grey" ? "#64748b" : rule.color;
    colorDot.textContent = "●";
    contentDiv.appendChild(colorDot);

    const nameSpan = document.createElement("span");
    nameSpan.className = "rule-name";
    nameSpan.title = rule.pattern || "";
    nameSpan.textContent = rule.name;
    contentDiv.appendChild(nameSpan);

    const patternSpan = document.createElement("span");
    patternSpan.className = "rule-pattern";
    patternSpan.textContent = `(${rule.pattern})`;
    contentDiv.appendChild(patternSpan);

    li.appendChild(contentDiv);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "rule-actions";
    
    const editBtn = document.createElement("span");
    editBtn.className = "action-btn btn-edit-rule";
    editBtn.dataset.index = index;
    editBtn.textContent = "編集";
    actionsDiv.appendChild(editBtn);

    const removeBtn = document.createElement("span");
    removeBtn.className = "action-btn btn-remove-rule";
    removeBtn.dataset.index = index;
    removeBtn.textContent = "削除";
    actionsDiv.appendChild(removeBtn);

    li.appendChild(actionsDiv);

    ruleList.appendChild(li);
  });
}

// Drag & Drop Handlers (Simple Reorder)
function handleDragStart(e) {
  dragStartIndex = +this.dataset.index;
  e.dataTransfer.effectAllowed = "move";
  this.classList.add("dragging");
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  
  // Determine drop position (above/below)
  const rect = this.getBoundingClientRect();
  const offsetY = e.clientY - rect.top;
  const height = rect.height;
  
  this.classList.remove("drop-above", "drop-below");
  
  if (offsetY < height * 0.5) {
      this.classList.add("drop-above");
      this.dataset.dropPos = "above";
  } else {
      this.classList.add("drop-below");
      this.dataset.dropPos = "below";
  }
}

function handleDragLeave(e) {
  this.classList.remove("drop-above", "drop-below");
}

function handleDragEnd() {
  this.classList.remove("dragging");
  document.querySelectorAll(".drop-above, .drop-below").forEach(el => 
      el.classList.remove("drop-above", "drop-below")
  );
}

async function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();
  
  document.querySelectorAll(".drop-above, .drop-below").forEach(el => 
      el.classList.remove("drop-above", "drop-below")
  );

  const targetIndex = +this.dataset.index;
  const dropPos = this.dataset.dropPos || 'below';
  
  if (dragStartIndex === targetIndex) return;

  const data = await chrome.storage.local.get(["settings"]);
  const settings = data.settings || DEFAULT_SETTINGS;
  
  // Flatten rules first to match UI indices
  let allRules = [];
  const flatten = (items) => {
      items.forEach(item => {
          if (item.type === 'folder') {
              if (item.children) flatten(item.children);
          } else {
              allRules.push(item);
          }
      });
  };
  flatten(settings.customRules || []);
  
  // Move item
  const itemToMove = allRules.splice(dragStartIndex, 1)[0];
  
  // Adjust insertion index
  // If dragging from above target, indices shift down. 
  // If dragStart < target, removal shifted target down by 1.
  
  // Actually, since we spliced from 'allRules', 'targetIndex' refers to the OLD index.
  // We need to calculate the NEW index in 'allRules'.
  
  // Simple Logic:
  // If dragStart < target, target index becomes target-1.
  // If dragStart > target, target index stays same.
  
  let insertIndex = targetIndex;
  if (dragStartIndex < targetIndex) {
      insertIndex--;
  }
  
  if (dropPos === 'below') {
      insertIndex++;
  }
  
  allRules.splice(insertIndex, 0, itemToMove);
  
  // Save flattened rules
  const updated = await updateSettings({ customRules: allRules });
  renderRuleList(updated.customRules);
}

// 設定の保存
async function updateSettings(updates) {
  const data = await chrome.storage.local.get(["settings"]);
  const settings = data.settings || DEFAULT_SETTINGS;
  const newSettings = { ...settings, ...updates };
  await chrome.storage.local.set({ settings: newSettings });
  return newSettings;
}

// イベントリスナー
autoCollapse.addEventListener("change", () => {
  updateSettings({ autoCollapse: autoCollapse.checked });
});

removeDuplicates.addEventListener("change", () => {
  updateSettings({ removeDuplicates: removeDuplicates.checked });
});

sortAlphabetically.addEventListener("change", () => {
  updateSettings({ sortAlphabetically: sortAlphabetically.checked });
});

addDomainBtn.addEventListener("click", async () => {
  const domain = domainInput.value.trim().toLowerCase();
  if (domain) {
    const data = await chrome.storage.local.get(["settings"]);
    const settings = data.settings || DEFAULT_SETTINGS;

    if (!settings.excludedDomains.includes(domain)) {
      const newList = [...settings.excludedDomains, domain];
      const updated = await updateSettings({ excludedDomains: newList });
      renderExclusionList(updated.excludedDomains);
      domainInput.value = "";
    }
  }
});

exclusionList.addEventListener("click", async (e) => {
  if (e.target.classList.contains("btn-remove")) {
    const domainToRemove = e.target.dataset.domain;
    const data = await chrome.storage.local.get(["settings"]);
    const settings = data.settings || DEFAULT_SETTINGS;

    const newList = settings.excludedDomains.filter(
      (d) => d !== domainToRemove
    );
    const updated = await updateSettings({ excludedDomains: newList });
    renderExclusionList(updated.excludedDomains);
  }
});

// 編集モードのリセット
function resetEditMode() {
  editingIndex = null;
  rulePattern.value = "";
  ruleName.value = "";
  ruleColor.value = "grey";
  addRuleBtn.textContent = "ルールを追加";
  cancelEditBtn.style.display = "none";
}

cancelEditBtn.addEventListener("click", resetEditMode);

addRuleBtn.addEventListener("click", async () => {
  const pattern = rulePattern.value.trim().toLowerCase();
  const name = ruleName.value.trim();
  const color = ruleColor.value;

  if (pattern && name) {
    const data = await chrome.storage.local.get(["settings"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    
    // Check if we need to flatten for edit
    let allRules = [];
    const flatten = (items) => {
        items.forEach(item => {
            if(item.type === 'folder') {
                if(item.children) flatten(item.children);
            } else {
                allRules.push(item);
            }
        });
    };
    flatten(settings.customRules || []);
    // Note: If we are not editing, 'allRules' might just be the loaded rules?
    // If user adds a rule, we should strictly speaking append to settings.customRules.
    // BUT if there are folders, we might be appending to a list that contains folders.
    // If we want to ABOLISH folders, we should convert everything to flat on saving.
    
    // Let's assume on Load/Add/Delete we enforce flat structure.
    
    if (editingIndex !== null) {
      allRules[editingIndex] = { ...allRules[editingIndex], pattern, name, color };
    } else {
      allRules.push({ type: 'rule', pattern, name, color });
    }

    const updated = await updateSettings({ customRules: allRules });
    renderRuleList(updated.customRules);

    // フォームとモードのリセット
    resetEditMode();
  }
});

ruleList.addEventListener("click", async (e) => {
  if (e.target.classList.contains("btn-remove-rule")) {
    const index = +e.target.dataset.index;
    if (!confirm("削除しますか？")) return;

    const data = await chrome.storage.local.get(["settings"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    
    // Flatten first
    let allRules = [];
    const flatten = (items) => {
        items.forEach(item => {
            if(item.type === 'folder') {
                if(item.children) flatten(item.children);
            } else {
                allRules.push(item);
            }
        });
    };
    flatten(settings.customRules || []);

    const newRules = allRules.filter((_, i) => i !== index);
    const updated = await updateSettings({ customRules: newRules });
    renderRuleList(updated.customRules);

    if (editingIndex === index) {
      resetEditMode();
    }
  } else if (e.target.classList.contains("btn-edit-rule")) {
    const index = +e.target.dataset.index;
    const data = await chrome.storage.local.get(["settings"]);
    const settings = data.settings || DEFAULT_SETTINGS;
    
    let allRules = [];
    const flatten = (items) => {
        items.forEach(item => {
            if(item.type === 'folder') {
                if(item.children) flatten(item.children);
            } else {
                allRules.push(item);
            }
        });
    };
    flatten(settings.customRules || []);

    const rule = allRules[index];
    if (rule) {
      editingIndex = index;
      rulePattern.value = rule.pattern;
      ruleName.value = rule.name;
      ruleColor.value = rule.color;
      addRuleBtn.textContent = "変更を保存";
      cancelEditBtn.style.display = "inline-block";
      rulePattern.focus();
    }
  }
});

// エクスポート機能
exportRulesBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['settings']);
    const rules = data.settings?.customRules || [];
    // Export potentially nested rules? Or flattened?
    // If we are abolishing, export flat.
    let allRules = [];
    const flatten = (items) => {
        items.forEach(item => {
            if(item.type === 'folder') {
                if(item.children) flatten(item.children);
            } else {
                allRules.push(item);
            }
        });
    };
    flatten(rules);

    const blob = new Blob([JSON.stringify(allRules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tab-grouper-rules.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// インポート機能
importRulesBtn.addEventListener('click', () => {
    importFile.click();
});

importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedRules = JSON.parse(event.target.result);
            if (!Array.isArray(importedRules)) throw new Error('Invalid format');

            // Flatten validation just in case
            let validRules = [];
             const flatten = (items) => {
                items.forEach(item => {
                    if (item.type === 'folder') {
                        if (item.children) flatten(item.children);
                    } else if (item.pattern && item.name) {
                        validRules.push(item);
                    }
                });
            };
            flatten(importedRules);

            if (validRules.length === 0) {
                alert('有効なルールが見つかりませんでした。');
                return;
            }

            const data = await chrome.storage.local.get(['settings']);
            const settings = data.settings || DEFAULT_SETTINGS;
            
            // 既存のルールをフラット化
            let currentRules = [];
            const flattenCurrent = (items) => {
                items.forEach(item => {
                     if (item.type === 'folder') {
                        if (item.children) flattenCurrent(item.children);
                    } else {
                        currentRules.push(item);
                    }
                });
            };
            flattenCurrent(settings.customRules || []);

            // 重複チェック: 既存のpatternと重複するルールを除外
            const existingPatterns = new Set(currentRules.map(r => r.pattern));
            const uniqueRules = validRules.filter(rule => !existingPatterns.has(rule.pattern));
            
            if (uniqueRules.length < validRules.length) {
                const skipped = validRules.length - uniqueRules.length;
                console.log(`${skipped}件の重複ルールをスキップしました`);
            }

            const newRules = [...currentRules, ...uniqueRules];
            
            const updated = await updateSettings({ customRules: newRules });
            renderRuleList(updated.customRules);
            
            const skippedCount = validRules.length - uniqueRules.length;
            if (skippedCount > 0) {
                alert(`${uniqueRules.length}件のルールをインポートしました。\n${skippedCount}件の重複ルールをスキップしました。`);
            } else {
                alert(`${uniqueRules.length}件のルールをインポートしました。`);
            }
            importFile.value = ''; 

        } catch (error) {
            console.error('Import error:', error);
            alert('ファイルの読み込みに失敗しました。');
        }
    };
    reader.readAsText(file);
});

// 初期化
loadSettings();
