/*
SCRIPTMETA-BEGIN
Script-ID=com.satorutakahashi.indesign.shortcut-search.jsx
Version=1.0.10
Meta-URL=https://github.com/SatoruTakahashi7/InDesign-shortcut-search
Target-App=indesign
Name=ショートカット検索
Author=GYAHTEI Design Laboratory / Satoru Takahashi
Description-BEGIN
InDesignのショートカットセットを読み込み、コマンド名・キー・機能エリアを
検索します。既存コマンドの実行、ショートカットの追加・競合置換・削除にも
対応します。プリセットは別名保存し、ユーザーセットは確認後に上書きします。
Description-END
SCRIPTMETA-END

    ショートカット検索 JSX版
    Version: 1.0.10
    Updated: 2026-08-09

    Credits:
    - Planning / testing / direction: GYAHTEI Design Laboratory @gyahtei_satoru
    - Development support: Codex

    注意事項:
    - このファイルだけで動作する単体版です。
    - プリセットは直接変更しません。ユーザーセットは確認後に上書きします。
    - .indkを更新した後、app.applyShortcutSet()でセットを適用します。
    - action-idがセッションごとに変わるスクリプト項目は実行対象外です。
    - InDesign 2023（18.5以降）・2024・2025・2026を対象にしています。
    - 本スクリプトの読み取り結果および使用結果について、正確性・完全性・
      動作継続性は保証できません。
    - 本スクリプトの利用により生じたデータの破損・損失、その他の損害について、
      制作者は責任を負いません。必ずバックアップを作成し、利用者自身の責任で
      使用してください。
*/

#target "InDesign"
#targetengine "shortcutSearchEngine"

function gyahteiJsonEscape(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t");
}

function gyahteiJson(value) {
    var i;
    var parts;
    if (value === null || value === undefined) {
        return "null";
    }
    if (typeof value === "string") {
        return "\"" + gyahteiJsonEscape(value) + "\"";
    }
    if (typeof value === "number") {
        return isFinite(value) ? String(value) : "null";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i++) {
            parts.push(gyahteiJson(value[i]));
        }
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (i in value) {
        if (value.hasOwnProperty(i)) {
            parts.push(gyahteiJson(i) + ":" + gyahteiJson(value[i]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function gyahteiReadUtf8(file) {
    file.encoding = "UTF-8";
    if (!file.open("r")) {
        throw new Error("ファイルを開けません: " + file.fsName);
    }
    var text = file.read();
    file.close();
    return text;
}

function gyahteiWriteUtf8(file, text) {
    file.encoding = "UTF-8";
    file.lineFeed = "Unix";
    if (!file.open("w")) {
        throw new Error("ファイルを保存できません: " + file.fsName);
    }
    file.write(text);
    file.close();
}

function gyahteiDecodeXml(value) {
    return String(value || "")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function gyahteiEncodeXml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function gyahteiCanonicalShortcut(value) {
    var source = String(value || "").replace(/^\s+|\s+$/g, "");
    var parts = source.split("+");
    var modifiers = {Ctrl: false, Opt: false, Shift: false, Cmd: false};
    var keys = [];
    var i;
    for (i = 0; i < parts.length; i++) {
        var part = String(parts[i] || "").replace(/^\s+|\s+$/g, "");
        var lower = part.toLowerCase();
        if (!part) { continue; }
        if (lower === "ctrl" || lower === "control") { modifiers.Ctrl = true; }
        else if (lower === "opt" || lower === "option" || lower === "alt") { modifiers.Opt = true; }
        else if (lower === "shift") { modifiers.Shift = true; }
        else if (lower === "cmd" || lower === "command" || lower === "meta") { modifiers.Cmd = true; }
        else { keys.push(part); }
    }
    if (source === "+" || /\+\+$/.test(source)) { keys.push("+"); }
    var result = [];
    if (modifiers.Ctrl) { result.push("Ctrl"); }
    if (modifiers.Opt) { result.push("Opt"); }
    if (modifiers.Shift) { result.push("Shift"); }
    if (modifiers.Cmd) { result.push("Cmd"); }
    return result.concat(keys).join("+");
}

function gyahteiParseActionExpression(expression) {
    var match = /^\s*0x([0-9a-f]+)\s*\+\s*([0-9]+)\s*$/i.exec(expression);
    var unsignedValue;
    if (match) {
        unsignedValue = parseInt(match[1], 16) + parseInt(match[2], 10);
    } else if (/^\s*0x[0-9a-f]+\s*$/i.test(expression)) {
        unsignedValue = parseInt(expression, 16);
    } else if (/^\s*[0-9]+\s*$/.test(expression)) {
        unsignedValue = parseInt(expression, 10);
    } else {
        return null;
    }
    unsignedValue = unsignedValue % 4294967296;
    if (unsignedValue < 0) {
        unsignedValue += 4294967296;
    }
    return {
        unsignedValue: unsignedValue,
        signedValue: unsignedValue > 2147483647 ? unsignedValue - 4294967296 : unsignedValue
    };
}

function gyahteiParseIndk(xmlText, resolveNames) {
    var records = [];
    var shortcutPattern = /<shortcut>([\s\S]*?)<\/shortcut>/g;
    var actionPattern = /<action-id\b([^>]*)>/;
    var valuePattern = /\bvalue="([^"]*)"/;
    var namePattern = /\bname="([^"]*)"/;
    var contextPattern = /<context>([\s\S]*?)<\/context>/;
    var stringPattern = /<string>([\s\S]*?)<\/string>/;
    var match;
    var nameCache = {};
    while ((match = shortcutPattern.exec(xmlText)) !== null) {
        var block = match[1];
        var action = actionPattern.exec(block);
        var context = contextPattern.exec(block);
        var shortcut = stringPattern.exec(block);
        if (!action || !shortcut) {
            continue;
        }
        var value = valuePattern.exec(action[1]);
        var internalNameMatch = namePattern.exec(action[1]);
        if (!value) {
            continue;
        }
        var expression = gyahteiDecodeXml(value[1]);
        var internalName = internalNameMatch ? gyahteiDecodeXml(internalNameMatch[1]) : "";
        var idInfo = gyahteiParseActionExpression(expression);
        var localizedName = "";
        var area = "";
        if (resolveNames && idInfo && internalName !== "" && idInfo.unsignedValue < 4278190080) {
            var cacheKey = String(idInfo.unsignedValue);
            if (nameCache.hasOwnProperty(cacheKey)) {
                localizedName = nameCache[cacheKey].name;
                area = nameCache[cacheKey].area;
            } else {
                try {
                    var menuAction = app.menuActions.itemByID(idInfo.signedValue);
                    localizedName = String(menuAction.name || "");
                    try {
                        area = String(menuAction.area || "");
                    } catch (areaError) {
                        area = "";
                    }
                } catch (nameError) {
                    localizedName = "";
                    area = "";
                }
                nameCache[cacheKey] = {name: localizedName, area: area};
            }
        }
        records.push({
            actionIdExpression: expression,
            actionId: idInfo ? idInfo.signedValue : null,
            actionIdUnsigned: idInfo ? idInfo.unsignedValue : null,
            internalName: internalName,
            name: localizedName,
            area: area,
            context: context ? gyahteiDecodeXml(context[1]) : "DefaultContext",
            shortcut: gyahteiDecodeXml(shortcut[1])
        });
    }
    return records;
}

function gyahteiPushIndkFiles(folder, kind, result) {
    if (!folder || !folder.exists) {
        return;
    }
    var files = folder.getFiles(function (entry) {
        return entry instanceof File && /\.indk$/i.test(entry.name);
    });
    var i;
    for (i = 0; i < files.length; i++) {
        result.push({
            name: decodeURI(files[i].name).replace(/\.indk$/i, ""),
            path: files[i].fsName,
            kind: kind
        });
    }
}

function gyahteiFindFolderRecursive(folder, targetName, maxDepth) {
    if (!folder || !folder.exists || maxDepth < 0) {
        return null;
    }
    if (decodeURI(folder.name) === targetName) {
        return folder;
    }
    var children = folder.getFiles(function (entry) { return entry instanceof Folder; });
    var i;
    for (i = 0; i < children.length; i++) {
        var found = gyahteiFindFolderRecursive(children[i], targetName, maxDepth - 1);
        if (found) {
            return found;
        }
    }
    return null;
}

function gyahteiGetUserShortcutFolder(createIfMissing) {
    var major = String(Math.floor(parseFloat(app.version)));
    var root;
    if ($.os.toLowerCase().indexOf("windows") >= 0) {
        root = new Folder(Folder.userData.fsName + "/Adobe/InDesign");
    } else {
        root = new Folder("~/Library/Preferences/Adobe InDesign");
    }
    if (!root.exists) {
        return null;
    }
    var versionPrefix = "Version " + major + ".0";
    var versionPattern = new RegExp("^Version " + major + "\\.0(?:-[A-Za-z])?$");
    var versions = root.getFiles(function (entry) {
        return entry instanceof Folder && versionPattern.test(decodeURI(entry.name));
    });
    versions.sort(function (a, b) {
        var aName = decodeURI(a.name);
        var bName = decodeURI(b.name);
        if (aName === versionPrefix) { return -1; }
        if (bName === versionPrefix) { return 1; }
        return aName < bName ? -1 : 1;
    });
    var i;
    for (i = 0; i < versions.length; i++) {
        var existing = gyahteiFindFolderRecursive(versions[i], "InDesign Shortcut Sets", 3);
        if (existing) {
            return existing;
        }
    }
    if (!createIfMissing || versions.length === 0) {
        return null;
    }
    var localeFolders = versions[0].getFiles(function (entry) {
        return entry instanceof Folder && /^[a-z]{2}_[A-Z]{2}$/i.test(decodeURI(entry.name));
    });
    if (localeFolders.length === 0) {
        return null;
    }
    var shortcutFolder = new Folder(localeFolders[0].fsName + "/InDesign Shortcut Sets");
    if (!shortcutFolder.exists && !shortcutFolder.create()) {
        return null;
    }
    return shortcutFolder;
}

function gyahteiGetPresetShortcutFolder() {
    var candidates = [];
    try { candidates.push(new Folder(app.filePath)); } catch (ignoreFilePath) {}
    try { candidates.push(new File(app.fullName).parent); } catch (ignoreFullName) {}
    var i;
    for (i = 0; i < candidates.length; i++) {
        var current = candidates[i];
        var depth;
        for (depth = 0; current && depth < 4; depth++) {
            var presetRoot = new Folder(current.fsName + "/Presets/InDesign Shortcut Sets");
            if (presetRoot.exists) {
                return presetRoot;
            }
            current = current.parent;
        }
    }
    return null;
}

function gyahteiListShortcutSets() {
    try {
        var result = [];
        var userFolder = gyahteiGetUserShortcutFolder(false);
        gyahteiPushIndkFiles(userFolder, "ユーザー", result);

        var presetRoot = gyahteiGetPresetShortcutFolder();
        if (presetRoot && presetRoot.exists) {
            var localeFolders = presetRoot.getFiles(function (entry) { return entry instanceof Folder; });
            var i;
            for (i = 0; i < localeFolders.length; i++) {
                gyahteiPushIndkFiles(localeFolders[i], "プリセット", result);
            }
        }
        result.sort(function (a, b) {
            if (a.kind !== b.kind) {
                return a.kind === "ユーザー" ? -1 : 1;
            }
            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
        });
        return gyahteiJson({ok: true, sets: result});
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiChooseShortcutSet() {
    try {
        var file = File.openDialog("InDesignショートカットセットを選択", "InDesign shortcut set:*.indk");
        if (!file) {
            return gyahteiJson({ok: false, canceled: true, message: "選択をキャンセルしました"});
        }
        return gyahteiJson({
            ok: true,
            set: {name: decodeURI(file.name).replace(/\.indk$/i, ""), path: file.fsName, kind: "選択ファイル"}
        });
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiReadShortcutSet(path) {
    try {
        var file = new File(path);
        if (!file.exists) {
            return gyahteiJson({ok: false, message: "ショートカットセットが見つかりません"});
        }
        var records = gyahteiParseIndk(gyahteiReadUtf8(file), true);
        var userFolder = gyahteiGetUserShortcutFolder(false);
        var kind = userFolder && file.parent.fsName === userFolder.fsName ? "ユーザー" : "プリセット";
        return gyahteiJson({
            ok: true,
            name: decodeURI(file.name).replace(/\.indk$/i, ""),
            path: file.fsName,
            kind: kind,
            records: records
        });
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiResolveMenuAction(candidates) {
    try {
        if (!(candidates instanceof Array)) {
            candidates = [String(candidates || "")];
        }
        var tried = {};
        var i;
        for (i = 0; i < candidates.length; i++) {
            var candidate = String(candidates[i] || "").replace(/^\s+|\s+$/g, "");
            if (!candidate || tried[candidate]) {
                continue;
            }
            tried[candidate] = true;
            try {
                var action = app.menuActions.itemByName(candidate);
                var resolvedName = String(action.name || "");
                var signedId = Number(action.id);
                if (resolvedName && !isNaN(signedId)) {
                    var unsignedId = signedId < 0 ? signedId + 4294967296 : signedId;
                    var resolvedExpression = "0x" + unsignedId.toString(16).toUpperCase();
                    var area = "";
                    try { area = String(action.area || ""); } catch (areaError) {}
                    var resolvedInternalName = "";
                    if (unsignedId >= 4278190080) {
                        resolvedExpression = "0xff000000 + " + (unsignedId - 4278190080);
                        resolvedInternalName = "スクリプト:" +
                            gyahteiNormalizeScriptPathName(resolvedName);
                    }
                    return gyahteiJson({
                        ok: true,
                        actionId: signedId,
                        actionIdUnsigned: unsignedId,
                        actionIdExpression: resolvedExpression,
                        name: resolvedName,
                        area: area,
                        internalName: resolvedInternalName
                    });
                }
            } catch (resolveError) {}
        }
        return gyahteiJson({ok: false, message: "このコマンドのaction-idを特定できません"});
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiNormalizeScriptPathName(value) {
    var result = String(value || "")
        .replace(/^\s+|\s+$/g, "")
        .replace(/^スクリプト:/, "")
        .replace(/\s*:\s*/g, ":")
        .replace(/(^|:)Scripts Panel(?=:|$)/ig, "$1")
        .replace(/:{2,}/g, ":")
        .replace(/^:+|:+$/g, "");
    return result.replace(/^User:/i, "ユーザー:")
        .replace(/^Application:/i, "アプリケーション:");
}

function gyahteiScriptPathLabel(labels, file) {
    var parts = [];
    var i;
    for (i = 0; i < labels.length; i++) {
        var label = String(labels[i] || "").replace(/^\s+|\s+$/g, "");
        if (/^Scripts Panel$/i.test(label)) { continue; }
        if (label) { parts.push(label); }
    }
    var fileName = file ? decodeURI(file.name) : "";
    var lastPart = parts.length ? parts[parts.length - 1] : "";
    var labelAlreadyHasFile = lastPart === fileName ||
        lastPart.slice(-(fileName.length + 1)) === ":" + fileName ||
        lastPart.slice(-(fileName.length + 1)) === "/" + fileName;
    if (fileName && !labelAlreadyHasFile) {
        parts.push(fileName);
    }
    var joined = gyahteiNormalizeScriptPathName(parts.join(":"));
    if (!/^(ユーザー|アプリケーション):/.test(joined)) {
        var applicationPath = "";
        try { applicationPath = String(app.filePath.fsName || "").toLowerCase(); } catch (ignoreAppPath) {}
        var scriptPath = file ? String(file.fsName || "").toLowerCase() : "";
        joined = (applicationPath && scriptPath.indexOf(applicationPath) === 0
            ? "アプリケーション:" : "ユーザー:") + joined;
    }
    return joined;
}

function gyahteiCollectCurrentScripts(node, labels, result, seen) {
    var i;
    if (node instanceof File) {
        var displayName = gyahteiScriptPathLabel(labels, node);
        if (!seen[displayName]) {
            seen[displayName] = true;
            result.push({
                name: displayName,
                area: "スクリプト",
                shortcutText: "[定義なし]",
                defined: false,
                actionId: null,
                actionIdExpression: "",
                internalName: "スクリプト:" + displayName,
                aliases: [
                    displayName,
                    decodeURI(node.name),
                    "ユーザー:" + decodeURI(node.name),
                    "アプリケーション:" + decodeURI(node.name),
                    "スクリプト:" + displayName
                ],
                executable: false,
                source: "現在のスクリプト一覧"
            });
        }
        return;
    }
    if (!(node instanceof Array)) { return; }
    if (node.length === 2 && typeof node[0] === "string") {
        gyahteiCollectCurrentScripts(node[1], labels.concat([node[0]]), result, seen);
        return;
    }
    for (i = 0; i < node.length; i++) {
        gyahteiCollectCurrentScripts(node[i], labels, result, seen);
    }
}

function gyahteiListCurrentScripts() {
    try {
        var result = [];
        gyahteiCollectCurrentScripts(app.scriptPreferences.scriptsList, [], result, {});
        return gyahteiJson({ok: true, scripts: result});
    } catch (error) {
        return gyahteiJson({ok: false, scripts: [], message: error.message});
    }
}

function gyahteiShortcutBlock(expression, internalName, context, shortcut) {
    var nameAttribute = internalName ? " name=\"" + gyahteiEncodeXml(internalName) + "\"" : "";
    return "\t<shortcut>\n" +
        "\t\t<action-id value=\"" + gyahteiEncodeXml(expression) + "\"" + nameAttribute + "></action-id>\n" +
        "\t\t<context>" + gyahteiEncodeXml(context) + "</context>\n" +
        "\t\t<string>" + gyahteiEncodeXml(shortcut) + "</string>\n" +
        "\t</shortcut>\n";
}

function gyahteiRecordMatchesAction(record, targetIdInfo, internalName) {
    var recordIdInfo = gyahteiParseActionExpression(record.actionIdExpression);
    if (recordIdInfo && targetIdInfo &&
            recordIdInfo.unsignedValue === targetIdInfo.unsignedValue) {
        return true;
    }
    if (!internalName || !record.internalName) { return false; }
    if (/^スクリプト:/.test(internalName) && /^スクリプト:/.test(record.internalName)) {
        return gyahteiNormalizeScriptPathName(record.internalName) ===
            gyahteiNormalizeScriptPathName(internalName);
    }
    return record.internalName === internalName;
}

function gyahteiApplyShortcutSetFresh(setName) {
    try {
        /* 同名セットの上書き後も再読込されるよう、一度デフォルトへ切り替える。 */
        app.applyShortcutSet();
    } catch (ignoreDefaultSet) {}
    app.applyShortcutSet(setName);
}

function gyahteiSaveShortcutSet(sourcePath, newSetName, expression, internalName, context, shortcut, allowOverwrite) {
    try {
        newSetName = String(newSetName || "").replace(/^\s+|\s+$/g, "");
        if (!newSetName) {
            return gyahteiJson({ok: false, message: "新しいセット名を入力してください"});
        }
        if (/[\\\/:*?\"<>|]/.test(newSetName)) {
            return gyahteiJson({ok: false, message: "セット名に使用できない文字が含まれています"});
        }
        if (!gyahteiParseActionExpression(expression)) {
            return gyahteiJson({ok: false, message: "このコマンドのaction-idは編集できません"});
        }
        shortcut = gyahteiCanonicalShortcut(shortcut);
        if (!shortcut) {
            return gyahteiJson({ok: false, message: "ショートカットを入力してください"});
        }
        var source = new File(sourcePath);
        if (!source.exists) {
            return gyahteiJson({ok: false, message: "元のセットが見つかりません"});
        }
        var targetFolder = gyahteiGetUserShortcutFolder(true);
        if (!targetFolder && !allowOverwrite) {
            return gyahteiJson({ok: false, message: "ユーザー用ショートカットフォルダーを特定できません"});
        }
        /* ユーザーセットの上書きでは、探索し直した別フォルダーではなく読込元そのものを更新する。 */
        var target = allowOverwrite ? source : new File(targetFolder.fsName + "/" + newSetName + ".indk");
        if (target.exists && !allowOverwrite) {
            return gyahteiJson({ok: false, message: "同名のセットが既にあります。別の名前を指定してください"});
        }

        var xmlText = gyahteiReadUtf8(source);
        var targetIdInfo = gyahteiParseActionExpression(expression);
        var keptBlocks = [];
        var conflictNames = [];
        var shortcutPattern = /<shortcut>([\s\S]*?)<\/shortcut>\s*/g;
        var blockMatch;
        while ((blockMatch = shortcutPattern.exec(xmlText)) !== null) {
            var fullBlock = "<shortcut>" + blockMatch[1] + "</shortcut>\n";
            var blockRecords = gyahteiParseIndk(fullBlock, false);
            if (blockRecords.length === 0) {
                keptBlocks.push("\t" + fullBlock.replace(/^\s+/, ""));
                continue;
            }
            var record = blockRecords[0];
            var sameAction = gyahteiRecordMatchesAction(record, targetIdInfo, internalName);
            var sameShortcutContext = gyahteiCanonicalShortcut(record.shortcut) === shortcut &&
                record.context === context;
            var sameExactAssignment = sameAction && sameShortcutContext;
            if (sameShortcutContext && !sameAction) {
                conflictNames.push(record.internalName || record.actionIdExpression);
            }
            if (!sameExactAssignment && !sameShortcutContext) {
                keptBlocks.push("\t" + fullBlock.replace(/^\s+/, ""));
            }
        }

        var headerMatch = /^[\s\S]*?<shortcut-set\b[^>]*>\s*/.exec(xmlText);
        if (!headerMatch) {
            return gyahteiJson({ok: false, message: "INDKのXML構造を確認できません"});
        }
        var output = headerMatch[0] + keptBlocks.join("") +
            gyahteiShortcutBlock(expression, internalName, context, shortcut) +
            "</shortcut-set>\n";
        gyahteiWriteUtf8(target, output);

        var applied = false;
        var applyMessage = "";
        try {
            gyahteiApplyShortcutSetFresh(newSetName);
            applied = true;
        } catch (applyError) {
            applyMessage = "保存しましたが自動適用できませんでした。キーボードショートカット画面で選択してください: " + applyError.message;
        }
        return gyahteiJson({
            ok: true,
            path: target.fsName,
            name: newSetName,
            applied: applied,
            conflicts: conflictNames,
            message: applied
                ? (allowOverwrite ? "ユーザーセットを上書きして適用しました" : "新しいセットを保存して適用しました")
                : applyMessage
        });
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiDeleteShortcutAssignment(sourcePath, newSetName, expression, internalName, context, shortcut, allowOverwrite) {
    try {
        newSetName = String(newSetName || "").replace(/^\s+|\s+$/g, "");
        if (!newSetName) {
            return gyahteiJson({ok: false, message: "保存先のセット名を入力してください"});
        }
        if (/[\\\/:*?\"<>|]/.test(newSetName)) {
            return gyahteiJson({ok: false, message: "セット名に使用できない文字が含まれています"});
        }
        shortcut = gyahteiCanonicalShortcut(shortcut);
        var targetIdInfo = gyahteiParseActionExpression(expression);
        if (!targetIdInfo) {
            return gyahteiJson({ok: false, message: "このコマンドのaction-idは編集できません"});
        }
        var source = new File(sourcePath);
        if (!source.exists) {
            return gyahteiJson({ok: false, message: "元のセットが見つかりません"});
        }
        var targetFolder = gyahteiGetUserShortcutFolder(true);
        if (!targetFolder && !allowOverwrite) {
            return gyahteiJson({ok: false, message: "ユーザー用ショートカットフォルダーを特定できません"});
        }
        /* ユーザーセットの削除も、選択中の実ファイルを直接更新する。 */
        var target = allowOverwrite ? source : new File(targetFolder.fsName + "/" + newSetName + ".indk");
        if (target.exists && !allowOverwrite) {
            return gyahteiJson({ok: false, message: "同名のセットが既にあります。別の名前を指定してください"});
        }

        var xmlText = gyahteiReadUtf8(source);
        var keptBlocks = [];
        var removedCount = 0;
        var shortcutPattern = /<shortcut>([\s\S]*?)<\/shortcut>\s*/g;
        var blockMatch;
        while ((blockMatch = shortcutPattern.exec(xmlText)) !== null) {
            var fullBlock = "<shortcut>" + blockMatch[1] + "</shortcut>\n";
            var blockRecords = gyahteiParseIndk(fullBlock, false);
            if (blockRecords.length === 0) {
                keptBlocks.push("\t" + fullBlock.replace(/^\s+/, ""));
                continue;
            }
            var record = blockRecords[0];
            var sameAction = gyahteiRecordMatchesAction(record, targetIdInfo, internalName);
            var isTarget = sameAction && record.context === context &&
                gyahteiCanonicalShortcut(record.shortcut) === shortcut;
            if (isTarget) {
                removedCount++;
            } else {
                keptBlocks.push("\t" + fullBlock.replace(/^\s+/, ""));
            }
        }
        if (removedCount === 0) {
            return gyahteiJson({ok: false, message: "削除するショートカットがセット内に見つかりません"});
        }

        var headerMatch = /^[\s\S]*?<shortcut-set\b[^>]*>\s*/.exec(xmlText);
        if (!headerMatch) {
            return gyahteiJson({ok: false, message: "INDKのXML構造を確認できません"});
        }
        gyahteiWriteUtf8(target, headerMatch[0] + keptBlocks.join("") + "</shortcut-set>\n");

        var applied = false;
        var applyMessage = "";
        try {
            gyahteiApplyShortcutSetFresh(newSetName);
            applied = true;
        } catch (applyError) {
            applyMessage = "保存しましたが自動適用できませんでした。キーボードショートカット画面で選択してください: " + applyError.message;
        }
        return gyahteiJson({
            ok: true,
            path: target.fsName,
            name: newSetName,
            applied: applied,
            removedCount: removedCount,
            message: applied
                ? (allowOverwrite ? "ショートカットを削除してユーザーセットを上書きしました" : "ショートカットを削除した新しいセットを保存しました")
                : applyMessage
        });
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiScriptUiKeyToken(keyName) {
    var key = String(keyName || "");
    var keyMap = {
        "Return": "#Keyboard_Return_Mac",
        "Enter": "#Keyboard_Enter_Mac",
        "Backspace": "#Keyboard_Delete_Mac",
        "Delete": "#Keyboard_Del_Mac",
        "Escape": "#Keyboard_Escape",
        "Esc": "#Keyboard_Escape",
        "Tab": "#Keyboard_Tab",
        "Space": "#Keyboard_Space",
        "Spacebar": "#Keyboard_Space",
        "Home": "#Keyboard_Home",
        "End": "#Keyboard_End",
        "PageUp": "#Keyboard_Page Up",
        "Page Up": "#Keyboard_Page Up",
        "PageDown": "#Keyboard_Page Down",
        "Page Down": "#Keyboard_Page Down",
        "Left": "#Keyboard_Left Arrow",
        "LeftArrow": "#Keyboard_Left Arrow",
        "Right": "#Keyboard_Right Arrow",
        "RightArrow": "#Keyboard_Right Arrow",
        "Up": "#Keyboard_Up Arrow",
        "UpArrow": "#Keyboard_Up Arrow",
        "Down": "#Keyboard_Down Arrow",
        "DownArrow": "#Keyboard_Down Arrow"
    };
    if (keyMap[key]) {
        return keyMap[key];
    }
    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
        return "#Keyboard_" + key.toUpperCase();
    }
    if (key.length === 1) {
        return key.toUpperCase();
    }
    return "";
}

function gyahteiCaptureShortcut() {
    try {
        var result = "";
        var dialog = new Window("dialog", "ショートカットを記録");
        dialog.orientation = "column";
        dialog.alignChildren = ["fill", "top"];
        dialog.margins = 16;
        dialog.spacing = 10;
        dialog.add("statictext", undefined, "割り当てたいキーを押してください");
        var capture = dialog.add("edittext", undefined, "キー入力待機中…");
        capture.characters = 32;
        var cancelButton = dialog.add("button", undefined, "キャンセル", {name: "cancel"});

        function handleKeyDown(event) {
            var keyName = String(event.keyName || event.keyIdentifier || "");
            if (/^(Meta|Command|Control|Ctrl|Alt|Option|Shift)$/i.test(keyName)) {
                return;
            }
            var token = gyahteiScriptUiKeyToken(keyName);
            if (!token) {
                capture.text = "取得できないキーです: " + keyName;
                return;
            }
            var state = ScriptUI.environment.keyboardState;
            var parts = [];
            var ctrlKey = event.ctrlKey === true || state.ctrlKey === true;
            var altKey = event.altKey === true || state.altKey === true;
            var shiftKey = event.shiftKey === true || state.shiftKey === true;
            var metaKey = event.metaKey === true || state.metaKey === true;
            if (ctrlKey) { parts.push("Ctrl"); }
            if (altKey) { parts.push("Opt"); }
            if (shiftKey) { parts.push("Shift"); }
            if (metaKey) { parts.push("Cmd"); }
            parts.push(token);
            result = parts.join("+");
            try { event.preventDefault(); } catch (ignorePrevent) {}
            try { event.stopPropagation(); } catch (ignoreStop) {}
            dialog.close(1);
        }

        capture.addEventListener("keydown", handleKeyDown);
        dialog.onShow = function () {
            capture.active = true;
        };
        cancelButton.onClick = function () { dialog.close(0); };
        var dialogResult = dialog.show();
        if (dialogResult !== 1 || !result) {
            return gyahteiJson({ok: false, canceled: true, message: "キー記録をキャンセルしました"});
        }
        return gyahteiJson({ok: true, shortcut: result});
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiInvokeMenuAction(actionId) {
    try {
        var numericId = Number(actionId);
        if (isNaN(numericId)) {
            return gyahteiJson({ok: false, message: "action-idが数値ではありません"});
        }
        app.menuActions.itemByID(numericId).invoke();
        return gyahteiJson({ok: true, message: "実行しました"});
    } catch (error) {
        return gyahteiJson({ok: false, message: error.message});
    }
}

function gyahteiGetHostVersion() {
    return String(app.version);
}
/* Base command catalog generated from InDesign 2023-2025 diagnostics. Live shortcuts are loaded from the selected .indk. */
var SHORTCUT_SEARCH_COMMANDS = [{"name":"InDesign について...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1},
{"name":"InDesign を隠す","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":2},
{"name":"エクステンションを管理...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":3},
{"name":"環境設定: GPU パフォーマンス...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":4},
{"name":"環境設定: UI の拡大・縮小...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":5},
{"name":"環境設定: インターフェイス...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":6},
{"name":"環境設定: ガイドとペーストボード...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":7},
{"name":"環境設定: クリップボードの処理...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":8},
{"name":"環境設定: グリッド...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":9},
{"name":"環境設定: ストーリーエディター...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":10},
{"name":"環境設定: スペル自動修正...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":11},
{"name":"環境設定: テキスト...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":12},
{"name":"環境設定: ファイル管理...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":13},
{"name":"環境設定: 一般...","area":"アプリケーションメニュー","shortcutText":"デフォルト: Cmd+K","defined":true,"actionId":39169,"actionIdExpression":"0x9900 + 1","internalName":"KBSCE Apple menu:Preferences: :General...","aliases":["一般...","KBSCE Apple menu:Preferences: :General..."],"executable":true,"source":"GYAHTEI.txt","id":14},
{"name":"環境設定: 単位と増減値...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":15},
{"name":"環境設定: 変更をトラック...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":16},
{"name":"環境設定: 文字枠グリッド...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":17},
{"name":"環境設定: 文字組みプリセットの表示設定...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":18},
{"name":"環境設定: 欧文スペルチェック...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":19},
{"name":"環境設定: 欧文辞書...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":20},
{"name":"環境設定: 注釈...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":21},
{"name":"環境設定: 組版...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":22},
{"name":"環境設定: 表示画質...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":23},
{"name":"環境設定: 高度なテキスト...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":24},
{"name":"環境設定: 黒の表示方法...","area":"アプリケーションメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":25},
{"name":"ユーザー設定: ユーザー設定を書き出し...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":26},
{"name":"ユーザー設定: ユーザー設定を読み込み...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":27},
{"name":"Adobe Express に書き出し","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":28},
{"name":"Adobe Stock を検索...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":29},
{"name":"Bridge で参照...","area":"ファイルメニュー","shortcutText":"デフォルト: Opt+Cmd+O","defined":true,"actionId":292,"actionIdExpression":"0x100 + 36","internalName":"KBSCE File menu:FileForBrowse","aliases":["Bridge で参照...","KBSCE File menu:FileForBrowse"],"executable":true,"source":"GYAHTEI.txt","id":30},
{"name":"CC ライブラリから配置...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":31},
{"name":"PDF コメントを読み込み...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":32},
{"name":"PDF 書き出しプリセット: プリセットを管理...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":33},
{"name":"Publish Online ダッシュボード...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":34},
{"name":"Publish Online...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":35},
{"name":"XML を読み込み...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":36},
{"name":"XML...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":37},
{"name":"コピーを保存...","area":"ファイルメニュー","shortcutText":"デフォルト: Opt+Cmd+S","defined":true,"actionId":262,"actionIdExpression":"0x100 + 6","internalName":"KBSCE File menu:Save a Copy...","aliases":["複製を保存...","コピーを保存...","KBSCE File menu:Save a Copy..."],"executable":true,"source":"GYAHTEI.txt","id":38},
{"name":"チェックイン...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":39},
{"name":"ドキュメントのプリセット: プリセットを管理...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":40},
{"name":"ドキュメントプリセット : デフォルト","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":41},
{"name":"ドキュメントプリセット : ドキュメントプリセット 1","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":42},
{"name":"ドキュメントプリセット : ドキュメントプリセット 2","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":43},
{"name":"ドキュメント設定...","area":"ファイルメニュー","shortcutText":"デフォルト: Opt+Cmd+P","defined":true,"actionId":24833,"actionIdExpression":"0x6100 + 1","internalName":"KBSCE File menu:Document Setup...","aliases":["ドキュメント設定...","KBSCE File menu:Document Setup..."],"executable":true,"source":"GYAHTEI.txt","id":44},
{"name":"バージョン...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":45},
{"name":"パッケージ...","area":"ファイルメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+P","defined":true,"actionId":39938,"actionIdExpression":"0x9c00 + 2","internalName":"KBSCE File menu:Packa&ge...","aliases":["パッケージ...","KBSCE File menu:Packa&ge..."],"executable":true,"source":"GYAHTEI.txt","id":46},
{"name":"ファイル情報...","area":"ファイルメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+I","defined":true,"actionId":75265,"actionIdExpression":"0x12600 + 1","internalName":"KBSCE File menu:File Information...","aliases":["ファイル情報...","KBSCE File menu:File Information..."],"executable":true,"source":"GYAHTEI.txt","id":47},
{"name":"プリント...","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+P","defined":true,"actionId":2563,"actionIdExpression":"0xa00 + 3","internalName":"KBSCE File menu:Print...","aliases":["プリント...","KBSCE File menu:Print..."],"executable":true,"source":"GYAHTEI.txt","id":48},
{"name":"プリントプリセット: プリセットを管理...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":49},
{"name":"ユーザー...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":50},
{"name":"レイアウトを調整...","area":"ファイルメニュー","shortcutText":"デフォルト: Opt+Shift+P","defined":true,"actionId":25082,"actionIdExpression":"0x6100 + 250","internalName":"KBSCE File menu:AdjustLayout...","aliases":["レイアウトを調整...","KBSCE File menu:AdjustLayout..."],"executable":true,"source":"GYAHTEI.txt","id":51},
{"name":"レビュー用に共有...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":52},
{"name":"保存","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+S","defined":true,"actionId":260,"actionIdExpression":"0x100 + 4","internalName":"KBSCE File menu:&Save","aliases":["保存","KBSCE File menu:&Save"],"executable":true,"source":"GYAHTEI.txt","id":53},
{"name":"別名で保存...","area":"ファイルメニュー","shortcutText":"デフォルト: Shift+Cmd+S","defined":true,"actionId":261,"actionIdExpression":"0x100 + 5","internalName":"KBSCE File menu:Save &As...","aliases":["別名で保存...","KBSCE File menu:Save &As..."],"executable":true,"source":"GYAHTEI.txt","id":54},
{"name":"小冊子をプリント...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":55},
{"name":"復帰","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":56},
{"name":"新規: ドキュメント...","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+N","defined":true,"actionId":257,"actionIdExpression":"0x100 + 1","internalName":"KBSCE File menu: New: :Document...","aliases":["ドキュメント...","KBSCE File menu: New: :Document..."],"executable":true,"source":"GYAHTEI.txt","id":57},
{"name":"新規: ブック...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":58},
{"name":"新規: ライブラリ...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":59},
{"name":"新規ウィンドウでブラウズ...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":60},
{"name":"書き出し...","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+E","defined":true,"actionId":113411,"actionIdExpression":"0x1bb00 + 3","internalName":"KBSCE File menu:Export...","aliases":["書き出し...","KBSCE File menu:Export..."],"executable":true,"source":"GYAHTEI.txt","id":61},
{"name":"編集に招待","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":62},
{"name":"配置...","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+D","defined":true,"actionId":113409,"actionIdExpression":"0x1bb00 + 1","internalName":"KBSCE File menu:&Place...","aliases":["配置...","KBSCE File menu:&Place..."],"executable":true,"source":"GYAHTEI.txt","id":63},
{"name":"閉じる","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+W","defined":true,"actionId":263,"actionIdExpression":"0x100 + 7","internalName":"KBSCE File menu:&Close","aliases":["閉じる","KBSCE File menu:&Close"],"executable":true,"source":"GYAHTEI.txt","id":64},
{"name":"開く...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":65},
{"name":"開く...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":66},
{"name":"開く...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":67},
{"name":"開く...","area":"ファイルメニュー","shortcutText":"デフォルト: Cmd+O","defined":true,"actionId":259,"actionIdExpression":"0x100 + 3","internalName":"KBSCE File menu:&Open...","aliases":["開く...","KBSCE File menu:&Open..."],"executable":true,"source":"GYAHTEI.txt","id":68},
{"name":"開く...","area":"ファイルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":69},
{"name":"Content Editing: Assign All Stories To: New...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":70},
{"name":"Content Editing: Assign Selection To: New...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":71},
{"name":"HTML を編集...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":72},
{"name":"InCopy: すべてのグラフィックをアサインに追加: 新規...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":73},
{"name":"InCopy: すべてのストーリーを割り当てに追加: 新規...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":74},
{"name":"InCopy: レイヤーをアサインに追加: 新規...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":75},
{"name":"InCopy: 書き出し: すべてのグラフィック...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":76},
{"name":"InCopy: 書き出し: すべてのグラフィックとストーリー...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":77},
{"name":"InCopy: 書き出し: すべてのストーリー...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":78},
{"name":"InCopy: 書き出し: レイヤー...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":79},
{"name":"InCopy: 書き出し: 選択範囲...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":80},
{"name":"InCopy: 選択範囲をアサインに追加: 新規...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":81},
{"name":"すべてをチェックイン","area":"編集メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+F9","defined":true,"actionId":102156,"actionIdExpression":"0x18f00 + 12","internalName":"KBSCE Edit menu:Submit All Stories in InDesign","aliases":["すべてをチェックイン","KBSCE Edit menu:Submit All Stories in InDesign"],"executable":true,"source":"GYAHTEI.txt","id":82},
{"name":"すべてを選択","area":"編集メニュー","shortcutText":"デフォルト: Cmd+A","defined":true,"actionId":276,"actionIdExpression":"0x100 + 20","internalName":"KBSCE Edit menu:Select &All","aliases":["すべてを選択","KBSCE Edit menu:Select &All"],"executable":true,"source":"GYAHTEI.txt","id":83},
{"name":"やり直し","area":"編集メニュー","shortcutText":"デフォルト: Shift+Cmd+Z","defined":true,"actionId":266,"actionIdExpression":"0x100 + 10","internalName":"KBSCE Edit menu:&Redo","aliases":["やり直し","KBSCE Edit menu:&Redo"],"executable":true,"source":"GYAHTEI.txt","id":84},
{"name":"オブジェクトスタイルを含む (o:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":85},
{"name":"カット","area":"編集メニュー","shortcutText":"デフォルト: Cmd+X","defined":true,"actionId":269,"actionIdExpression":"0x100 + 13","internalName":"KBSCE Edit menu:Cu&t","aliases":["カット","KBSCE Edit menu:Cu&t"],"executable":true,"source":"GYAHTEI.txt","id":86},
{"name":"カラー設定...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":87},
{"name":"キーボードショートカット...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":88},
{"name":"クイックアクセス...","area":"編集メニュー","shortcutText":"デフォルト: Cmd+Return","defined":true,"actionId":18771,"actionIdExpression":"0x4900 + 83","internalName":"KBSCE Edit menu:Killer Find...","aliases":["クイックアクセス...","KBSCE Edit menu:Killer Find..."],"executable":true,"source":"GYAHTEI.txt","id":89},
{"name":"コピー","area":"編集メニュー","shortcutText":"デフォルト: Cmd+C","defined":true,"actionId":270,"actionIdExpression":"0x100 + 14","internalName":"KBSCE Edit menu:&Copy_2","aliases":["コピー","KBSCE Edit menu:&Copy_2"],"executable":true,"source":"GYAHTEI.txt","id":90},
{"name":"コンテンツを保存","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":91},
{"name":"コンテンツを更新","area":"編集メニュー","shortcutText":"デフォルト: Ctrl+Cmd+F5","defined":true,"actionId":102155,"actionIdExpression":"0x18f00 + 11","internalName":"KBSCE Edit menu:Update Story in InDesign","aliases":["コンテンツを更新","KBSCE Edit menu:Update Story in InDesign"],"executable":true,"source":"GYAHTEI.txt","id":92},
{"name":"スクリプトを含む (s:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":93},
{"name":"ストーリーエディターで編集","area":"編集メニュー","shortcutText":"デフォルト: Cmd+Y","defined":true,"actionId":119793,"actionIdExpression":"0x1d300 + 241","internalName":"KBSCE Edit menu:Edit Story","aliases":["ストーリーエディターで編集","KBSCE Edit menu:Edit Story"],"executable":true,"source":"GYAHTEI.txt","id":94},
{"name":"セルスタイルを含む (e:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":95},
{"name":"ソースに移動","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":96},
{"name":"チェックアウト","area":"編集メニュー","shortcutText":"デフォルト: Cmd+F9","defined":true,"actionId":102149,"actionIdExpression":"0x18f00 + 5","internalName":"KBSCE Edit menu:Edit in InDesign","aliases":["チェックアウト","KBSCE Edit menu:Edit in InDesign"],"executable":true,"source":"GYAHTEI.txt","id":97},
{"name":"チェックアウトをキャンセル","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":98},
{"name":"チェックイン","area":"編集メニュー","shortcutText":"デフォルト: Shift+Cmd+F9","defined":true,"actionId":102151,"actionIdExpression":"0x18f00 + 7","internalName":"KBSCE Edit menu:Submit Story","aliases":["チェックイン","KBSCE Edit menu:Submit Story"],"executable":true,"source":"GYAHTEI.txt","id":99},
{"name":"テキスト変数を含む (v:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":100},
{"name":"プロファイルの指定...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":101},
{"name":"プロファイル変換...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":102},
{"name":"ペースト","area":"編集メニュー","shortcutText":"デフォルト: Cmd+V","defined":true,"actionId":271,"actionIdExpression":"0x100 + 15","internalName":"KBSCE Edit menu:&Paste","aliases":["ペースト","KBSCE Edit menu:&Paste"],"executable":true,"source":"GYAHTEI.txt","id":103},
{"name":"メニュー...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":104},
{"name":"メニューコマンドを含む (m:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":105},
{"name":"リンクとして配置","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":106},
{"name":"以前のローカル設定を移行...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":107},
{"name":"似た画像を検索","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":108},
{"name":"元の位置にペースト","area":"編集メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+F","defined":true,"actionId":273,"actionIdExpression":"0x100 + 17","internalName":"KBSCE Edit menu:Paste in Place","aliases":["元の位置にペースト","KBSCE Edit menu:Paste in Place"],"executable":true,"source":"GYAHTEI.txt","id":109},
{"name":"元データを編集","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":110},
{"name":"取り消し","area":"編集メニュー","shortcutText":"デフォルト: Cmd+Z","defined":true,"actionId":265,"actionIdExpression":"0x100 + 9","internalName":"KBSCE Edit menu:&Undo","aliases":["オブジェクトスタイルを削除を取り消し","取り消し","リンクを更新を取り消し","KBSCE Edit menu:&Undo"],"executable":true,"source":"GYAHTEI.txt","id":111},
{"name":"文字スタイルを含む (c:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":112},
{"name":"書式なしでペースト","area":"編集メニュー","shortcutText":"デフォルト: Shift+Cmd+V","defined":true,"actionId":296,"actionIdExpression":"0x100 + 40","internalName":"KBSCE Edit menu:Paste&Unformatted","aliases":["書式なしでペースト","KBSCE Edit menu:Paste&Unformatted"],"executable":true,"source":"GYAHTEI.txt","id":113},
{"name":"検索と置換...","area":"編集メニュー","shortcutText":"デフォルト: Cmd+F","defined":true,"actionId":18694,"actionIdExpression":"0x4900 + 6","internalName":"KBSCE Edit menu:EditMenu_FindChange","aliases":["検索と置換...","KBSCE Edit menu:EditMenu_FindChange"],"executable":true,"source":"GYAHTEI.txt","id":114},
{"name":"検索方向を切り換え","area":"編集メニュー","shortcutText":"デフォルト: Opt+Cmd+Return","defined":true,"actionId":127966,"actionIdExpression":"0x1f300 + 222","internalName":"KBSCE Edit menu:Toggle_Direction","aliases":["検索方向を切り換え","KBSCE Edit menu:Toggle_Direction"],"executable":true,"source":"GYAHTEI.txt","id":115},
{"name":"次を検索","area":"編集メニュー","shortcutText":"デフォルト: Opt+Cmd+F","defined":true,"actionId":18695,"actionIdExpression":"0x4900 + 7","internalName":"KBSCE Edit menu:Find Next","aliases":["次を検索","KBSCE Edit menu:Find Next"],"executable":true,"source":"GYAHTEI.txt","id":116},
{"name":"欧文スペルチェック: スペル自動修正","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":117},
{"name":"欧文スペルチェック: ダイナミックスペルチェック","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":118},
{"name":"欧文スペルチェック: ユーザー辞書...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":119},
{"name":"欧文スペルチェック: 欧文スペルチェック...","area":"編集メニュー","shortcutText":"デフォルト: Cmd+I","defined":true,"actionId":121345,"actionIdExpression":"0x1da00 + 1","internalName":"KBSCE Edit menu: Spelling: :Check Spelling...","aliases":["欧文スペルチェック...","KBSCE Edit menu: Spelling: :Check Spelling..."],"executable":true,"source":"GYAHTEI.txt","id":120},
{"name":"段落スタイルを含む (p:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":121},
{"name":"消去","area":"編集メニュー","shortcutText":"デフォルト: Delete, デフォルト: Cmd+Delete, デフォルト: Del, デフォルト: Cmd+Del","defined":true,"actionId":272,"actionIdExpression":"0x100 + 16","internalName":"KBSCE Edit menu:C&lear","aliases":["消去","KBSCE Edit menu:C&lear"],"executable":true,"source":"GYAHTEI.txt","id":122},
{"name":"繰り返し複製...","area":"編集メニュー","shortcutText":"デフォルト: Opt+Cmd+U","defined":true,"actionId":43521,"actionIdExpression":"0xaa00 + 1","internalName":"KBSCE Edit menu:Step and Repeat...","aliases":["繰り返し複製...","KBSCE Edit menu:Step and Repeat..."],"executable":true,"source":"GYAHTEI.txt","id":123},
{"name":"表スタイルを含む (t:)","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":124},
{"name":"複製","area":"編集メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+D","defined":true,"actionId":275,"actionIdExpression":"0x100 + 19","internalName":"KBSCE Edit menu:&Duplicate","aliases":["複製","KBSCE Edit menu:&Duplicate"],"executable":true,"source":"GYAHTEI.txt","id":125},
{"name":"透明の分割・統合プリセット...","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":126},
{"name":"透明ブレンド領域の設定: ドキュメントの CMYK 領域を使用","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":127},
{"name":"透明ブレンド領域の設定: ドキュメントの RGB 領域を使用","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":128},
{"name":"選択を解除","area":"編集メニュー","shortcutText":"デフォルト: Shift+Cmd+A","defined":true,"actionId":278,"actionIdExpression":"0x100 + 22","internalName":"KBSCE Edit menu:Deselect Al&l","aliases":["選択を解除","KBSCE Edit menu:Deselect Al&l"],"executable":true,"source":"GYAHTEI.txt","id":129},
{"name":"選択範囲内へペースト","area":"編集メニュー","shortcutText":"デフォルト: Opt+Cmd+V","defined":true,"actionId":274,"actionIdExpression":"0x100 + 18","internalName":"KBSCE Edit menu:Paste Into","aliases":["選択範囲内へペースト","KBSCE Edit menu:Paste Into"],"executable":true,"source":"GYAHTEI.txt","id":130},
{"name":"非表示のメニューコマンドを表示","area":"編集メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":131},
{"name":"ガイドを作成...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":132},
{"name":"ページ: スプレッドを隠す","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":133},
{"name":"ページ: ページを削除...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":134},
{"name":"ページ: ページを追加","area":"レイアウトメニュー","shortcutText":"デフォルト: Shift+Cmd+P","defined":true,"actionId":24346,"actionIdExpression":"0x5f00 + 26","internalName":"KBSCE Layout menu: Pages: :Add New Page","aliases":["ページを追加","KBSCE Layout menu: Pages: :Add New Page"],"executable":true,"source":"GYAHTEI.txt","id":135},
{"name":"ページへ移動...","area":"レイアウトメニュー","shortcutText":"デフォルト: Cmd+J","defined":true,"actionId":118807,"actionIdExpression":"0x1d000 + 23","internalName":"KBSCE Layout menu:Go to &Page...","aliases":["ページへ移動...","KBSCE Layout menu:Go to &Page..."],"executable":true,"source":"GYAHTEI.txt","id":136},
{"name":"ページ番号とセクションの設定...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":137},
{"name":"マージン・段組...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":138},
{"name":"リキッドレイアウト","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":139},
{"name":"先頭ページ","area":"レイアウトメニュー","shortcutText":"デフォルト: Shift+Cmd+Page Up","defined":true,"actionId":24333,"actionIdExpression":"0x5f00 + 13","internalName":"KBSCE Layout menu:&First Page","aliases":["先頭ページ","KBSCE Layout menu:&First Page"],"executable":true,"source":"GYAHTEI.txt","id":140},
{"name":"前に戻る","area":"レイアウトメニュー","shortcutText":"デフォルト: Cmd+Page Up","defined":true,"actionId":22786,"actionIdExpression":"0x5900 + 2","internalName":"KBSCE Layout menu:Go Back","aliases":["前に戻る","KBSCE Layout menu:Go Back"],"executable":true,"source":"GYAHTEI.txt","id":141},
{"name":"前スプレッド","area":"レイアウトメニュー","shortcutText":"デフォルト: Opt+Page Up, プレゼンテーションモード: Shift+スペースバー, プレゼンテーションモード: Delete, プレゼンテーションモード: 上向き矢印, プレゼンテーションモード: Page Up","defined":true,"actionId":118817,"actionIdExpression":"0x1d000 + 33","internalName":"KBSCE Layout menu:Pr&evious Spread","aliases":["前スプレッド","KBSCE Layout menu:Pr&evious Spread"],"executable":true,"source":"GYAHTEI.txt","id":142},
{"name":"前ページ","area":"レイアウトメニュー","shortcutText":"デフォルト: Shift+Page Up, テキスト: Shift+Page Up","defined":true,"actionId":24336,"actionIdExpression":"0x5f00 + 16","internalName":"KBSCE Layout menu:&Previous Page","aliases":["前ページ","KBSCE Layout menu:&Previous Page"],"executable":true,"source":"GYAHTEI.txt","id":143},
{"name":"右スプレッド","area":"レイアウトメニュー","shortcutText":"プレゼンテーションモード: 右向き矢印","defined":true,"actionId":118860,"actionIdExpression":"0x1d000 + 76","internalName":"KBSCE Layout menu:Right Spread","aliases":["右スプレッド","KBSCE Layout menu:Right Spread"],"executable":true,"source":"GYAHTEI.txt","id":144},
{"name":"定規ガイド...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":145},
{"name":"左スプレッド","area":"レイアウトメニュー","shortcutText":"プレゼンテーションモード: 左向き矢印","defined":true,"actionId":118859,"actionIdExpression":"0x1d000 + 75","internalName":"KBSCE Layout menu:Left Spread","aliases":["左スプレッド","KBSCE Layout menu:Left Spread"],"executable":true,"source":"GYAHTEI.txt","id":146},
{"name":"最終ページ","area":"レイアウトメニュー","shortcutText":"デフォルト: Shift+Cmd+Page Down","defined":true,"actionId":24334,"actionIdExpression":"0x5f00 + 14","internalName":"KBSCE Layout menu:&Last Page","aliases":["最終ページ","KBSCE Layout menu:&Last Page"],"executable":true,"source":"GYAHTEI.txt","id":147},
{"name":"次に進む","area":"レイアウトメニュー","shortcutText":"デフォルト: Cmd+Page Down","defined":true,"actionId":22787,"actionIdExpression":"0x5900 + 3","internalName":"KBSCE Layout menu:Go Forward","aliases":["次に進む","KBSCE Layout menu:Go Forward"],"executable":true,"source":"GYAHTEI.txt","id":148},
{"name":"次スプレッド","area":"レイアウトメニュー","shortcutText":"デフォルト: Opt+Page Down, プレゼンテーションモード: スペースバー, プレゼンテーションモード: 下向き矢印, プレゼンテーションモード: Return, プレゼンテーションモード: Page Down","defined":true,"actionId":118818,"actionIdExpression":"0x1d000 + 34","internalName":"KBSCE Layout menu:Ne&xt Spread","aliases":["次スプレッド","KBSCE Layout menu:Ne&xt Spread"],"executable":true,"source":"GYAHTEI.txt","id":149},
{"name":"次ページ","area":"レイアウトメニュー","shortcutText":"デフォルト: Shift+Page Down, テキスト: Shift+Page Down","defined":true,"actionId":24335,"actionIdExpression":"0x5f00 + 15","internalName":"KBSCE Layout menu:&Next Page","aliases":["次ページ","KBSCE Layout menu:&Next Page"],"executable":true,"source":"GYAHTEI.txt","id":150},
{"name":"目次...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":151},
{"name":"目次の更新","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":152},
{"name":"目次スタイル...","area":"レイアウトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":153},
{"name":"URL をハイパーリンクに変換...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":154},
{"name":"すべて無視","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":155},
{"name":"アウトラインを作成","area":"書式メニュー","shortcutText":"デフォルト: Shift+Cmd+O","defined":true,"actionId":61405,"actionIdExpression":"0xef00 + 221","internalName":"KBSCE Type menu:Create Outlines menu","aliases":["アウトラインを作成","KBSCE Type menu:Create Outlines menu"],"executable":true,"source":"GYAHTEI.txt","id":156},
{"name":"サンプルテキストの割り付け","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":157},
{"name":"タブ","area":"書式メニュー","shortcutText":"デフォルト: Shift+Cmd+T","defined":true,"actionId":26372,"actionIdExpression":"0x6700 + 4","internalName":"KBSCE Type menu:Tabs_menu","aliases":["タブ","KBSCE Type menu:Tabs_menu"],"executable":true,"source":"GYAHTEI.txt","id":158},
{"name":"テキストを削除せずにアウトラインを作成する","area":"書式メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+O","defined":true,"actionId":61406,"actionIdExpression":"0xef00 + 222","internalName":"KBSCE Type menu:Create outlines without deleting text","aliases":["テキストを削除せずにアウトラインを作成する","KBSCE Type menu:Create outlines without deleting text"],"executable":true,"source":"GYAHTEI.txt","id":159},
{"name":"テキスト変数: 変数をテキストに変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":160},
{"name":"テキスト変数: 変数を管理...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":161},
{"name":"パス上文字: オプション...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":162},
{"name":"パス上文字: パス上文字を削除","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":163},
{"name":"フォントの検索と置換...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":164},
{"name":"分割文字を挿入: 任意の改行","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":165},
{"name":"分割文字を挿入: 偶数改ページ","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":166},
{"name":"分割文字を挿入: 奇数改ページ","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":167},
{"name":"分割文字を挿入: 強制改行","area":"書式メニュー","shortcutText":"テキスト: Shift+Return","defined":true,"actionId":119584,"actionIdExpression":"0x1d300 + 32","internalName":"KBSCE Type menu: Insert Break Character: :Soft return","aliases":["強制改行","KBSCE Type menu: Insert Break Character: :Soft return"],"executable":true,"source":"GYAHTEI.txt","id":168},
{"name":"分割文字を挿入: 改フレーム","area":"書式メニュー","shortcutText":"テキスト: Shift+Enter","defined":true,"actionId":119657,"actionIdExpression":"0x1d300 + 105","internalName":"KBSCE Type menu: Insert Break Character: :Frame Break","aliases":["改フレーム","KBSCE Type menu: Insert Break Character: :Frame Break"],"executable":true,"source":"GYAHTEI.txt","id":169},
{"name":"分割文字を挿入: 改ページ","area":"書式メニュー","shortcutText":"テキスト: Cmd+Enter","defined":true,"actionId":119658,"actionIdExpression":"0x1d300 + 106","internalName":"KBSCE Type menu: Insert Break Character: :Page Break","aliases":["改ページ","KBSCE Type menu: Insert Break Character: :Page Break"],"executable":true,"source":"GYAHTEI.txt","id":170},
{"name":"分割文字を挿入: 改段","area":"書式メニュー","shortcutText":"テキスト: Enter","defined":true,"actionId":119656,"actionIdExpression":"0x1d300 + 104","internalName":"KBSCE Type menu: Insert Break Character: :Column Break","aliases":["改段","KBSCE Type menu: Insert Break Character: :Column Break"],"executable":true,"source":"GYAHTEI.txt","id":171},
{"name":"分割文字を挿入: 段落改行","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":172},
{"name":"分割文字を挿入: 結合なし","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":173},
{"name":"制御文字を表示","area":"書式メニュー","shortcutText":"デフォルト: Opt+Cmd+I","defined":true,"actionId":119553,"actionIdExpression":"0x1d300 + 1","internalName":"KBSCE Type menu:Hide Hidden Characters","aliases":["制御文字を隠す","制御文字を表示","KBSCE Type menu:Hide Hidden Characters"],"executable":true,"source":"GYAHTEI.txt","id":174},
{"name":"変更をトラック: このユーザーによるすべての変更を取り消し: このストーリー","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":175},
{"name":"変更をトラック: このユーザーによるすべての変更を取り消し: このドキュメント","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":176},
{"name":"変更をトラック: このユーザーによるすべての変更を適用: このストーリー","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":177},
{"name":"変更をトラック: このユーザーによるすべての変更を適用: このドキュメント","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":178},
{"name":"変更をトラック: すべての変更を取り消し: このストーリー","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":179},
{"name":"変更をトラック: すべての変更を取り消し: このドキュメント","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":180},
{"name":"変更をトラック: すべての変更を適用: このストーリー","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":181},
{"name":"変更をトラック: すべての変更を適用: このドキュメント","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":182},
{"name":"変更をトラック: 全ストーリーでトラックを有効にする","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":183},
{"name":"変更をトラック: 全ストーリーでトラックを無効にする","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":184},
{"name":"変更をトラック: 前の変更","area":"書式メニュー","shortcutText":"テキスト: Cmd+Page Up","defined":true,"actionId":42247,"actionIdExpression":"0xa500 + 7","internalName":"KBSCE Type menu: ChangesSubmenu: :TCMenu_PreviousChange","aliases":["前の変更","KBSCE Type menu: ChangesSubmenu: :TCMenu_PreviousChange"],"executable":true,"source":"GYAHTEI.txt","id":185},
{"name":"変更をトラック: 変更を取り消し","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":186},
{"name":"変更をトラック: 変更を取り消して次を検索","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":187},
{"name":"変更をトラック: 変更を適用","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":188},
{"name":"変更をトラック: 変更を適用して次を検索","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":189},
{"name":"変更をトラック: 次の変更","area":"書式メニュー","shortcutText":"テキスト: Cmd+Page Down","defined":true,"actionId":42248,"actionIdExpression":"0xa500 + 8","internalName":"KBSCE Type menu: ChangesSubmenu: :TCMenu_NextChange","aliases":["次の変更","KBSCE Type menu: ChangesSubmenu: :TCMenu_NextChange"],"executable":true,"source":"GYAHTEI.txt","id":190},
{"name":"変更をトラック: 現在のストーリー内の変更をトラック","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":191},
{"name":"大文字と小文字の変更: すべて大文字","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":192},
{"name":"大文字と小文字の変更: すべて小文字","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":193},
{"name":"大文字と小文字の変更: 単語の先頭のみ大文字","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":194},
{"name":"大文字と小文字の変更: 文頭のみ大文字","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":195},
{"name":"後注を挿入","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":196},
{"name":"後注オプション...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":197},
{"name":"後注テキストへ移動","area":"書式メニュー","shortcutText":"テキスト: Shift+Cmd+E","defined":true,"actionId":47280,"actionIdExpression":"0xb800 + 176","internalName":"KBSCE Type menu:MarkerToEndnote","aliases":["後注テキストへ移動","KBSCE Type menu:MarkerToEndnote"],"executable":true,"source":"GYAHTEI.txt","id":198},
{"name":"横組み","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":199},
{"name":"注釈: すべての注釈を削除","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":200},
{"name":"注釈: ストーリーから注釈を削除","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":201},
{"name":"注釈: ストーリーを注釈に変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":202},
{"name":"注釈: ストーリー内のすべての注釈を展開 (折りたたみ)","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":203},
{"name":"注釈: テキストに変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":204},
{"name":"注釈: テキストを注釈にコピー","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":205},
{"name":"注釈: 前の注釈","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":206},
{"name":"注釈: 単語を注釈に変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":207},
{"name":"注釈: 新規注釈","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":208},
{"name":"注釈: 次の注釈","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":209},
{"name":"注釈: 段落を注釈に変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":210},
{"name":"注釈: 注釈に変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":211},
{"name":"注釈: 注釈を分割","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":212},
{"name":"注釈: 注釈を削除","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":213},
{"name":"注釈: 注釈を開く","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":214},
{"name":"注釈: 注釈モード","area":"書式メニュー","shortcutText":"テキスト: Cmd+F8","defined":true,"actionId":47892,"actionIdExpression":"0xbb00 + 20","internalName":"KBSCE Type menu: NotesSubmenu: :NotesMenu_NotesMode","aliases":["注釈モード","KBSCE Type menu: NotesSubmenu: :NotesMenu_NotesMode"],"executable":true,"source":"GYAHTEI.txt","id":215},
{"name":"注釈: 行を注釈に変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":216},
{"name":"特殊文字を挿入: その他: タブ","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":217},
{"name":"特殊文字を挿入: その他: 先頭文字スタイルの終了文字","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":218},
{"name":"特殊文字を挿入: その他: 右インデント タブ","area":"書式メニュー","shortcutText":"テキスト: Shift+Tab","defined":true,"actionId":119673,"actionIdExpression":"0x1d300 + 121","internalName":"KBSCE Type menu: Insert Special Character: Other: :Right margin tab","aliases":["右インデント タブ","KBSCE Type menu: Insert Special Character: Other: :Right margin tab"],"executable":true,"source":"GYAHTEI.txt","id":219},
{"name":"特殊文字を挿入: その他: ｢ここまでインデント｣ 文字","area":"書式メニュー","shortcutText":"テキスト: Cmd+\\, テキスト: Cmd+¥","defined":true,"actionId":119674,"actionIdExpression":"0x1d300 + 122","internalName":"KBSCE Type menu: Insert Special Character: Other: :Indent to here","aliases":["｢ここまでインデント｣ 文字","KBSCE Type menu: Insert Special Character: Other: :Indent to here"],"executable":true,"source":"GYAHTEI.txt","id":220},
{"name":"特殊文字を挿入: ハイフンおよびダッシュ: EM ダッシュ","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":221},
{"name":"特殊文字を挿入: ハイフンおよびダッシュ: EN ダッシュ","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":222},
{"name":"特殊文字を挿入: ハイフンおよびダッシュ: 任意ハイフン","area":"書式メニュー","shortcutText":"テキスト: Shift+Cmd+-","defined":true,"actionId":119583,"actionIdExpression":"0x1d300 + 31","internalName":"KBSCE Type menu: Insert Special Character: Hyphens and Dashes: :Insert discretionary hyphen","aliases":["任意ハイフン","KBSCE Type menu: Insert Special Character: Hyphens and Dashes: :Insert discretionary hyphen"],"executable":true,"source":"GYAHTEI.txt","id":223},
{"name":"特殊文字を挿入: ハイフンおよびダッシュ: 分散禁止ハイフン","area":"書式メニュー","shortcutText":"テキスト: Opt+Cmd+-","defined":true,"actionId":119587,"actionIdExpression":"0x1d300 + 35","internalName":"KBSCE Type menu: Insert Special Character: Hyphens and Dashes: :Insert non-breaking hyphen","aliases":["分散禁止ハイフン","KBSCE Type menu: Insert Special Character: Hyphens and Dashes: :Insert non-breaking hyphen"],"executable":true,"source":"GYAHTEI.txt","id":224},
{"name":"特殊文字を挿入: マーカー: セクションマーカー","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":225},
{"name":"特殊文字を挿入: マーカー: 前ページ番号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":226},
{"name":"特殊文字を挿入: マーカー: 次ページ番号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":227},
{"name":"特殊文字を挿入: マーカー: 現在のページ番号","area":"書式メニュー","shortcutText":"テキスト: Opt+Shift+Cmd+N","defined":true,"actionId":119585,"actionIdExpression":"0x1d300 + 33","internalName":"KBSCE Type menu: Insert Special Character: Markers: :InsertSpecial Page Number","aliases":["現在のページ番号","KBSCE Type menu: Insert Special Character: Markers: :InsertSpecial Page Number"],"executable":true,"source":"GYAHTEI.txt","id":228},
{"name":"特殊文字を挿入: マーカー: 脚注番号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":229},
{"name":"特殊文字を挿入: 引用符: 半角一重引用符 (アポストロフィ)","area":"書式メニュー","shortcutText":"テキスト: Ctrl+'","defined":true,"actionId":47189,"actionIdExpression":"0xb800 + 85","internalName":"KBSCE Type menu: Insert Special Character: Quotation Marks: :Insert SSQ","aliases":["半角一重引用符 (アポストロフィ)","KBSCE Type menu: Insert Special Character: Quotation Marks: :Insert SSQ"],"executable":true,"source":"GYAHTEI.txt","id":230},
{"name":"特殊文字を挿入: 引用符: 半角二重引用符","area":"書式メニュー","shortcutText":"テキスト: Ctrl+Shift+'","defined":true,"actionId":47188,"actionIdExpression":"0xb800 + 84","internalName":"KBSCE Type menu: Insert Special Character: Quotation Marks: :Insert SDQ","aliases":["半角二重引用符","KBSCE Type menu: Insert Special Character: Quotation Marks: :Insert SDQ"],"executable":true,"source":"GYAHTEI.txt","id":231},
{"name":"特殊文字を挿入: 引用符: 右二重引用符","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":232},
{"name":"特殊文字を挿入: 引用符: 右引用符","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":233},
{"name":"特殊文字を挿入: 引用符: 左二重引用符","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":234},
{"name":"特殊文字を挿入: 引用符: 左引用符","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":235},
{"name":"特殊文字を挿入: 記号: セクション記号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":236},
{"name":"特殊文字を挿入: 記号: ビュレット","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":237},
{"name":"特殊文字を挿入: 記号: 中点","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":238},
{"name":"特殊文字を挿入: 記号: 商標記号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":239},
{"name":"特殊文字を挿入: 記号: 段落記号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":240},
{"name":"特殊文字を挿入: 記号: 登録商標記号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":241},
{"name":"特殊文字を挿入: 記号: 省略記号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":242},
{"name":"特殊文字を挿入: 記号: 著作権記号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":243},
{"name":"空白文字を挿入: 1/3 スペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":244},
{"name":"空白文字を挿入: 1/4 スペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":245},
{"name":"空白文字を挿入: 1/6 スペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":246},
{"name":"空白文字を挿入: EM スペース","area":"書式メニュー","shortcutText":"テキスト: Shift+Cmd+M","defined":true,"actionId":119591,"actionIdExpression":"0x1d300 + 39","internalName":"KBSCE Type menu: Insert White Space: :Insert em space","aliases":["EM スペース","KBSCE Type menu: Insert White Space: :Insert em space"],"executable":true,"source":"GYAHTEI.txt","id":247},
{"name":"空白文字を挿入: EN スペース","area":"書式メニュー","shortcutText":"テキスト: Shift+Cmd+N","defined":true,"actionId":119592,"actionIdExpression":"0x1d300 + 40","internalName":"KBSCE Type menu: Insert White Space: :Insert en space","aliases":["EN スペース","KBSCE Type menu: Insert White Space: :Insert en space"],"executable":true,"source":"GYAHTEI.txt","id":248},
{"name":"空白文字を挿入: フラッシュスペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":249},
{"name":"空白文字を挿入: 全角スペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":250},
{"name":"空白文字を挿入: 分散禁止スペース","area":"書式メニュー","shortcutText":"テキスト: Opt+Cmd+X","defined":true,"actionId":119594,"actionIdExpression":"0x1d300 + 42","internalName":"KBSCE Type menu: Insert White Space: :Insert non-breaking space","aliases":["分散禁止スペース","KBSCE Type menu: Insert White Space: :Insert non-breaking space"],"executable":true,"source":"GYAHTEI.txt","id":251},
{"name":"空白文字を挿入: 分散禁止スペース (固定幅)","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":252},
{"name":"空白文字を挿入: 句読点等のスペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":253},
{"name":"空白文字を挿入: 数字のスペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":254},
{"name":"空白文字を挿入: 極細スペース","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":255},
{"name":"空白文字を挿入: 細いスペース","area":"書式メニュー","shortcutText":"テキスト: Opt+Shift+Cmd+M","defined":true,"actionId":119589,"actionIdExpression":"0x1d300 + 37","internalName":"KBSCE Type menu: Insert White Space: :Insert thin space","aliases":["細いスペース","KBSCE Type menu: Insert White Space: :Insert thin space"],"executable":true,"source":"GYAHTEI.txt","id":256},
{"name":"箇条書きリスト: リストを定義...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":257},
{"name":"箇条書きリスト: 振り直し・継続自動番号","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":258},
{"name":"箇条書きリスト: 番号を適用","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":259},
{"name":"箇条書きリスト: 箇条書きをテキストに変換","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":260},
{"name":"箇条書きリスト: 記号を適用","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":261},
{"name":"縦組み","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":262},
{"name":"脚注と後注を変換する...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":263},
{"name":"脚注を挿入","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":264},
{"name":"脚注オプション...","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":265},
{"name":"脚注テキストへ移動","area":"書式メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":266},
{"name":"画像から抽出: カラーテーマ","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":267},
{"name":"画像から抽出: シェイプ","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":268},
{"name":"画像から抽出: 文字","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":269},
{"name":"Adobe Stock を検索...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":270},
{"name":"HTML を挿入...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":271},
{"name":"MathML を挿入...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":272},
{"name":"QR コードを生成...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":273},
{"name":"すべてをロック解除","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":274},
{"name":"アンカーオブジェクト: オプション...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":275},
{"name":"アンカーオブジェクト: 挿入...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":276},
{"name":"アンカーオブジェクト: 解除","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":277},
{"name":"インタラクティブ: オブジェクトに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":278},
{"name":"インタラクティブ: コンボボックスに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":279},
{"name":"インタラクティブ: タブ順を設定...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":280},
{"name":"インタラクティブ: チェックボックスに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":281},
{"name":"インタラクティブ: テキストフィールドに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":282},
{"name":"インタラクティブ: ボタンに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":283},
{"name":"インタラクティブ: ラジオボタンに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":284},
{"name":"インタラクティブ: リストボックスに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":285},
{"name":"インタラクティブ: 署名フィールドに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":286},
{"name":"オブジェクトサイズの調整: フレームに均等に流し込む","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+C","defined":true,"actionId":11347,"actionIdExpression":"0x2c00 + 83","internalName":"KBSCE Object menu: Fitting: :Fi&ll Frame Proportionally","aliases":["フレームに均等に流し込む","KBSCE Object menu: Fitting: :Fi&ll Frame Proportionally"],"executable":true,"source":"GYAHTEI.txt","id":287},
{"name":"オブジェクトサイズの調整: フレームを内容に合わせる","area":"オブジェクトメニュー","shortcutText":"デフォルト: Shift+Cmd+N","defined":true,"actionId":11291,"actionIdExpression":"0x2c00 + 27","internalName":"KBSCE Object menu: Fitting: :Fit &Frame to Content","aliases":["フレームを内容に合わせる","KBSCE Object menu: Fitting: :Fit &Frame to Content"],"executable":true,"source":"GYAHTEI.txt","id":288},
{"name":"オブジェクトサイズの調整: フレーム調整オプション...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":289},
{"name":"オブジェクトサイズの調整: フレーム調整オプションを消去","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":290},
{"name":"オブジェクトサイズの調整: 内容をフレームに合わせる","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":291},
{"name":"オブジェクトサイズの調整: 内容を中央に揃える","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+N","defined":true,"actionId":11294,"actionIdExpression":"0x2c00 + 30","internalName":"KBSCE Object menu: Fitting: :Ce&nter Content","aliases":["内容を中央に揃える","KBSCE Object menu: Fitting: :Ce&nter Content"],"executable":true,"source":"GYAHTEI.txt","id":292},
{"name":"オブジェクトサイズの調整: 内容を縦横比率に応じて合わせる","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+E","defined":true,"actionId":11293,"actionIdExpression":"0x2c00 + 29","internalName":"KBSCE Object menu: Fitting: :Fit Content &Proportionally","aliases":["内容を縦横比率に応じて合わせる","KBSCE Object menu: Fitting: :Fit Content &Proportionally"],"executable":true,"source":"GYAHTEI.txt","id":293},
{"name":"オブジェクトサイズの調整: 内容を自動認識に応じて合わせる","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+X","defined":true,"actionId":11399,"actionIdExpression":"0x2c00 + 135","internalName":"KBSCE Object menu: Fitting: :C&ontent-Aware Fit","aliases":["内容を自動認識に応じて合わせる","KBSCE Object menu: Fitting: :C&ontent-Aware Fit"],"executable":true,"source":"GYAHTEI.txt","id":294},
{"name":"オブジェクトレイヤーオプション...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":295},
{"name":"オブジェクト書き出しオプション...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":296},
{"name":"キャプション: キャプションに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":297},
{"name":"キャプション: キャプションの作成","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":298},
{"name":"キャプション: キャプション設定...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":299},
{"name":"キャプション: ライブキャプションの作成","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":300},
{"name":"クリッピングパス: オプション...","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+K","defined":true,"actionId":34817,"actionIdExpression":"0x8800 + 1","internalName":"KBSCE Object menu: Clipping Path: :Clipping Path...","aliases":["オプション...","KBSCE Object menu: Clipping Path: :Clipping Path..."],"executable":true,"source":"GYAHTEI.txt","id":301},
{"name":"クリッピングパス: クリッピングパスをフレームに変換","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":302},
{"name":"グループ","area":"オブジェクトメニュー","shortcutText":"デフォルト: Cmd+G","defined":true,"actionId":118844,"actionIdExpression":"0x1d000 + 60","internalName":"KBSCE Object menu:&Group","aliases":["グループ","KBSCE Object menu:&Group"],"executable":true,"source":"GYAHTEI.txt","id":303},
{"name":"グループ解除","area":"オブジェクトメニュー","shortcutText":"デフォルト: Shift+Cmd+G","defined":true,"actionId":118845,"actionIdExpression":"0x1d000 + 61","internalName":"KBSCE Object menu:&Ungroup","aliases":["グループ解除","KBSCE Object menu:&Ungroup"],"executable":true,"source":"GYAHTEI.txt","id":304},
{"name":"コーナーオプション...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":305},
{"name":"シェイプを変換: 三角","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":306},
{"name":"シェイプを変換: 多角形","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":307},
{"name":"シェイプを変換: 楕円","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":308},
{"name":"シェイプを変換: 直交線","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":309},
{"name":"シェイプを変換: 線","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":310},
{"name":"シェイプを変換: 角丸長方形 (内側)","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":311},
{"name":"シェイプを変換: 角丸長方形 (外側)","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":312},
{"name":"シェイプを変換: 長方形","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":313},
{"name":"シェイプを変換: 面取り長方形","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":314},
{"name":"シェイプを変換: 飾り付きの長方形","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":315},
{"name":"スプレッド上のすべてをロック解除","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+L","defined":true,"actionId":11395,"actionIdExpression":"0x2c00 + 131","internalName":"KBSCE Object menu:Unlock All on Spread Action","aliases":["スプレッド上のすべてをロック解除","KBSCE Object menu:Unlock All on Spread Action"],"executable":true,"source":"GYAHTEI.txt","id":316},
{"name":"スプレッド上のすべてを表示","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+3","defined":true,"actionId":118857,"actionIdExpression":"0x1d000 + 73","internalName":"KBSCE Object menu:Show All on Spread Action","aliases":["スプレッド上のすべてを表示","KBSCE Object menu:Show All on Spread Action"],"executable":true,"source":"GYAHTEI.txt","id":317},
{"name":"テキストフレーム設定...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":318},
{"name":"パス: パスの反転","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":319},
{"name":"パス: パスを閉じる","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":320},
{"name":"パス: パスを開く","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":321},
{"name":"パス: ポイントを変換: スムーズ","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":322},
{"name":"パス: ポイントを変換: 左右対称","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":323},
{"name":"パス: ポイントを変換: 標準","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":324},
{"name":"パス: ポイントを変換: 角","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":325},
{"name":"パス: 結合形式","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":326},
{"name":"パス: 複合パスを作成","area":"オブジェクトメニュー","shortcutText":"デフォルト: Cmd+8","defined":true,"actionId":99585,"actionIdExpression":"0x18500 + 1","internalName":"KBSCE Object menu: Paths: :Make","aliases":["複合パスを作成","KBSCE Object menu: Paths: :Make"],"executable":true,"source":"GYAHTEI.txt","id":327},
{"name":"パス: 複合パスを解除","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+8","defined":true,"actionId":99586,"actionIdExpression":"0x18500 + 2","internalName":"KBSCE Object menu: Paths: :Release","aliases":["複合パスを解除","KBSCE Object menu: Paths: :Release"],"executable":true,"source":"GYAHTEI.txt","id":328},
{"name":"パスファインダー: 中マド","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":329},
{"name":"パスファインダー: 交差","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":330},
{"name":"パスファインダー: 前面オブジェクトで型抜き","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":331},
{"name":"パスファインダー: 合体","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":332},
{"name":"パスファインダー: 背面オブジェクトで型抜き","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":333},
{"name":"ベースラインオプション","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":334},
{"name":"ロック","area":"オブジェクトメニュー","shortcutText":"デフォルト: Cmd+L","defined":true,"actionId":11304,"actionIdExpression":"0x2c00 + 40","internalName":"KBSCE Object menu:&Lock Position","aliases":["ロック","KBSCE Object menu:&Lock Position"],"executable":true,"source":"GYAHTEI.txt","id":335},
{"name":"ロック解除","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":336},
{"name":"内容: グラフィック","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":337},
{"name":"内容: テキスト","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":338},
{"name":"内容: 割り当てなし","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":339},
{"name":"再変形: 一連の変形を個別に再実行","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":340},
{"name":"再変形: 一連の変形を再実行","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+4","defined":true,"actionId":118837,"actionIdExpression":"0x1d000 + 53","internalName":"KBSCE Object menu: Transform Again: :Transform Sequence Again","aliases":["一連の変形を再実行","KBSCE Object menu: Transform Again: :Transform Sequence Again"],"executable":true,"source":"GYAHTEI.txt","id":341},
{"name":"再変形: 変形を個別に再実行","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":342},
{"name":"再変形: 変形を再実行","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":343},
{"name":"効果: すべての透明を消去","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":344},
{"name":"効果: グラデーションぼかし...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":345},
{"name":"効果: サテン...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":346},
{"name":"効果: シャドウ (内側)...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":347},
{"name":"効果: ドロップシャドウ...","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+M","defined":true,"actionId":67868,"actionIdExpression":"0x10900 + 28","internalName":"KBSCE Object menu: Effects: :kFXMenuDropShadow","aliases":["ドロップシャドウ...","KBSCE Object menu: Effects: :kFXMenuDropShadow"],"executable":true,"source":"GYAHTEI.txt","id":348},
{"name":"効果: ベベルとエンボス...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":349},
{"name":"効果: 光彩 (内側)...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":350},
{"name":"効果: 光彩 (外側)...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":351},
{"name":"効果: 効果を消去","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":352},
{"name":"効果: 包括光源...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":353},
{"name":"効果: 基本のぼかし...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":354},
{"name":"効果: 方向性のぼかし...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":355},
{"name":"効果: 透明...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":356},
{"name":"変形: 180 °回転","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":357},
{"name":"変形: 90 °回転 (反時計回り)","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":358},
{"name":"変形: 90 °回転 (時計回り)","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":359},
{"name":"変形: ガイドの移動...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":360},
{"name":"変形: シアー...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":361},
{"name":"変形: 回転...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":362},
{"name":"変形: 垂直方向に反転","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":363},
{"name":"変形: 拡大・縮小...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":364},
{"name":"変形: 水平方向に反転","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":365},
{"name":"変形: 移動...","area":"オブジェクトメニュー","shortcutText":"デフォルト: Shift+Cmd+M","defined":true,"actionId":118799,"actionIdExpression":"0x1d000 + 15","internalName":"KBSCE Object menu: Transform: :&Move...","aliases":["移動...","KBSCE Object menu: Transform: :&Move..."],"executable":true,"source":"GYAHTEI.txt","id":366},
{"name":"画像カラー設定...","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":367},
{"name":"表示画質の設定: 一般表示","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":368},
{"name":"表示画質の設定: 表示設定を使用","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":369},
{"name":"表示画質の設定: 高品質表示","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":370},
{"name":"表示画質の設定: 高速表示","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":371},
{"name":"選択: コンテンツ","area":"オブジェクトメニュー","shortcutText":"デフォルト: Shift+Esc","defined":true,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":372},
{"name":"選択: 前のオブジェクト","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":373},
{"name":"選択: 前面のオブジェクト","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+]","defined":true,"actionId":11287,"actionIdExpression":"0x2c00 + 23","internalName":"KBSCE Object menu: Select: :Next Object Above","aliases":["前面のオブジェクト","KBSCE Object menu: Select: :Next Object Above"],"executable":true,"source":"GYAHTEI.txt","id":374},
{"name":"選択: 最前面のオブジェクト","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+]","defined":true,"actionId":11289,"actionIdExpression":"0x2c00 + 25","internalName":"KBSCE Object menu: Select: :First Object Above","aliases":["最前面のオブジェクト","KBSCE Object menu: Select: :First Object Above"],"executable":true,"source":"GYAHTEI.txt","id":375},
{"name":"選択: 最背面のオブジェクト","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+[","defined":true,"actionId":11290,"actionIdExpression":"0x2c00 + 26","internalName":"KBSCE Object menu: Select: :Last Object Below","aliases":["最背面のオブジェクト","KBSCE Object menu: Select: :Last Object Below"],"executable":true,"source":"GYAHTEI.txt","id":376},
{"name":"選択: 次のオブジェクト","area":"オブジェクトメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":377},
{"name":"選択: 背面のオブジェクト","area":"オブジェクトメニュー","shortcutText":"デフォルト: Opt+Cmd+[","defined":true,"actionId":11288,"actionIdExpression":"0x2c00 + 24","internalName":"KBSCE Object menu: Select: :Next Object Below","aliases":["背面のオブジェクト","KBSCE Object menu: Select: :Next Object Below"],"executable":true,"source":"GYAHTEI.txt","id":378},
{"name":"選択: 親のフレーム","area":"オブジェクトメニュー","shortcutText":"デフォルト: Esc","defined":true,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":379},
{"name":"重ね順: 前面へ","area":"オブジェクトメニュー","shortcutText":"デフォルト: Cmd+]","defined":true,"actionId":11284,"actionIdExpression":"0x2c00 + 20","internalName":"KBSCE Object menu: Arrange: :Bring For&ward","aliases":["前面へ","KBSCE Object menu: Arrange: :Bring For&ward"],"executable":true,"source":"GYAHTEI.txt","id":380},
{"name":"重ね順: 最前面へ","area":"オブジェクトメニュー","shortcutText":"デフォルト: Shift+Cmd+]","defined":true,"actionId":11283,"actionIdExpression":"0x2c00 + 19","internalName":"KBSCE Object menu: Arrange: :Bring To &Front","aliases":["最前面へ","KBSCE Object menu: Arrange: :Bring To &Front"],"executable":true,"source":"GYAHTEI.txt","id":381},
{"name":"重ね順: 最背面へ","area":"オブジェクトメニュー","shortcutText":"デフォルト: Shift+Cmd+[","defined":true,"actionId":11286,"actionIdExpression":"0x2c00 + 22","internalName":"KBSCE Object menu: Arrange: :Send To Bac&k","aliases":["最背面へ","KBSCE Object menu: Arrange: :Send To Bac&k"],"executable":true,"source":"GYAHTEI.txt","id":382},
{"name":"重ね順: 背面へ","area":"オブジェクトメニュー","shortcutText":"デフォルト: Cmd+[","defined":true,"actionId":11285,"actionIdExpression":"0x2c00 + 21","internalName":"KBSCE Object menu: Arrange: :Send &Backward","aliases":["背面へ","KBSCE Object menu: Arrange: :Send &Backward"],"executable":true,"source":"GYAHTEI.txt","id":383},
{"name":"隠す","area":"オブジェクトメニュー","shortcutText":"デフォルト: Cmd+3","defined":true,"actionId":118856,"actionIdExpression":"0x1d000 + 72","internalName":"KBSCE Object menu:Hide Page Item Action","aliases":["隠す","KBSCE Object menu:Hide Page Item Action"],"executable":true,"source":"GYAHTEI.txt","id":384},
{"name":"セルの属性: グラフィック...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":385},
{"name":"セルの属性: テキスト...","area":"表メニュー","shortcutText":"表: Opt+Cmd+B","defined":true,"actionId":66820,"actionIdExpression":"0x10500 + 4","internalName":"KBSCE Table menu: Cell Options: :kTablesMenuText..._&","aliases":["テキスト...","KBSCE Table menu: Cell Options: :kTablesMenuText..._&"],"executable":true,"source":"GYAHTEI.txt","id":386},
{"name":"セルの属性: 斜線の設定...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":387},
{"name":"セルの属性: 罫線と塗り...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":388},
{"name":"セルの属性: 行と列の設定...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":389},
{"name":"セルをグラフィックセルに変換","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":390},
{"name":"セルをテキストセルに変換","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":391},
{"name":"セルを垂直に分割","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":392},
{"name":"セルを水平に分割","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":393},
{"name":"セルを結合","area":"表メニュー","shortcutText":"デフォルト: Cmd+1","defined":true,"actionId":66837,"actionIdExpression":"0x10500 + 21","internalName":"KBSCE Table menu:kTablesMenuMerge Cells_&","aliases":["セルを結合","KBSCE Table menu:kTablesMenuMerge Cells_&"],"executable":true,"source":"GYAHTEI.txt","id":394},
{"name":"セルを結合解除","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":395},
{"name":"テキストを表に変換...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":396},
{"name":"フッターに","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":397},
{"name":"フッターの編集","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":398},
{"name":"フッター行に変換","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":399},
{"name":"ヘッダーに","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":400},
{"name":"ヘッダーの編集","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":401},
{"name":"ヘッダー行に変換","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":402},
{"name":"列幅の均等化","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":403},
{"name":"削除: 列","area":"表メニュー","shortcutText":"表: Shift+Delete","defined":true,"actionId":66829,"actionIdExpression":"0x10500 + 13","internalName":"KBSCE Table menu: Delete: :kTablesMenuColumn_&","aliases":["列","KBSCE Table menu: Delete: :kTablesMenuColumn_&"],"executable":true,"source":"GYAHTEI.txt","id":404},
{"name":"削除: 行","area":"表メニュー","shortcutText":"表: Cmd+Delete","defined":true,"actionId":66828,"actionIdExpression":"0x10500 + 12","internalName":"KBSCE Table menu: Delete: :kTablesMenuRow_&","aliases":["行","KBSCE Table menu: Delete: :kTablesMenuRow_&"],"executable":true,"source":"GYAHTEI.txt","id":405},
{"name":"削除: 表","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":406},
{"name":"前にペースト","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":407},
{"name":"後にペースト","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":408},
{"name":"指定行へ移動...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":409},
{"name":"挿入: 列...","area":"表メニュー","shortcutText":"表: Opt+Cmd+9","defined":true,"actionId":66824,"actionIdExpression":"0x10500 + 8","internalName":"KBSCE Table menu: Insert: :kTablesMenuColumn..._&","aliases":["列...","KBSCE Table menu: Insert: :kTablesMenuColumn..._&"],"executable":true,"source":"GYAHTEI.txt","id":410},
{"name":"挿入: 行...","area":"表メニュー","shortcutText":"表: Cmd+9","defined":true,"actionId":66823,"actionIdExpression":"0x10500 + 7","internalName":"KBSCE Table menu: Insert: :kTablesMenuRow..._&","aliases":["行...","KBSCE Table menu: Insert: :kTablesMenuRow..._&"],"executable":true,"source":"GYAHTEI.txt","id":411},
{"name":"本文に","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":412},
{"name":"本文行に変換","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":413},
{"name":"行高の均等化","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":414},
{"name":"表の属性: ヘッダーとフッター...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":415},
{"name":"表の属性: 列の罫線...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":416},
{"name":"表の属性: 塗りのスタイル...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":417},
{"name":"表の属性: 行の罫線...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":418},
{"name":"表の属性: 表の設定...","area":"表メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+B","defined":true,"actionId":66876,"actionIdExpression":"0x10500 + 60","internalName":"KBSCE Table menu: Table Options: :TableSetup...","aliases":["表の設定...","KBSCE Table menu: Table Options: :TableSetup..."],"executable":true,"source":"GYAHTEI.txt","id":419},
{"name":"表をテキストに変換...","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":420},
{"name":"表を作成...","area":"表メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+T, テキスト: Opt+Shift+Cmd+T","defined":true,"actionId":66822,"actionIdExpression":"0x10500 + 6","internalName":"KBSCE Table menu:kTablesMenuInsert Table..._&","aliases":["表を作成...","KBSCE Table menu:kTablesMenuInsert Table..._&"],"executable":true,"source":"GYAHTEI.txt","id":421},
{"name":"選択: セル","area":"表メニュー","shortcutText":"表: Cmd+/","defined":true,"actionId":66844,"actionIdExpression":"0x10500 + 28","internalName":"KBSCE Table menu: Select: :kTablesMenuCell_&","aliases":["セル","KBSCE Table menu: Select: :kTablesMenuCell_&"],"executable":true,"source":"GYAHTEI.txt","id":422},
{"name":"選択: フッター行","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":423},
{"name":"選択: ヘッダー行","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":424},
{"name":"選択: 列","area":"表メニュー","shortcutText":"表: Opt+Cmd+3","defined":true,"actionId":66826,"actionIdExpression":"0x10500 + 10","internalName":"KBSCE Table menu: Select: :kTablesMenuColumn_&","aliases":["列","KBSCE Table menu: Select: :kTablesMenuColumn_&"],"executable":true,"source":"GYAHTEI.txt","id":425},
{"name":"選択: 本文行","area":"表メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":426},
{"name":"選択: 行","area":"表メニュー","shortcutText":"表: Cmd+3","defined":true,"actionId":66825,"actionIdExpression":"0x10500 + 9","internalName":"KBSCE Table menu: Select: :kTablesMenuRow_&","aliases":["行","KBSCE Table menu: Select: :kTablesMenuRow_&"],"executable":true,"source":"GYAHTEI.txt","id":427},
{"name":"選択: 表","area":"表メニュー","shortcutText":"表: Opt+Cmd+A","defined":true,"actionId":66827,"actionIdExpression":"0x10500 + 11","internalName":"KBSCE Table menu: Select: :kTablesMenuTable_&","aliases":["表","KBSCE Table menu: Select: :kTablesMenuTable_&"],"executable":true,"source":"GYAHTEI.txt","id":428},
{"name":"100% 表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":429},
{"name":"CPU でプレビュー","area":"表示メニュー","shortcutText":"デフォルト: Shift+E","defined":true,"actionId":78357,"actionIdExpression":"0x13200 + 21","internalName":"KBSCE View menu:kCPUPreview","aliases":["CPU でプレビュー","KBSCE View menu:kCPUPreview"],"executable":true,"source":"GYAHTEI.txt","id":430},
{"name":"アプリケーションフレーム","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":431},
{"name":"インキ管理...","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":432},
{"name":"エクストラ: Stock 購入バッジを隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":433},
{"name":"エクストラ: アサインされたフレームを表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":434},
{"name":"エクストラ: アンカー付きオブジェクトの制御マークを隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":435},
{"name":"エクストラ: コンテンツグラバーを表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":436},
{"name":"エクストラ: コンベヤーを隠す","area":"表示メニュー","shortcutText":"デフォルト: Opt+B","defined":true,"actionId":137236,"actionIdExpression":"0x21800 + 20","internalName":"KBSCE View menu: ExtrasSubmenu: :kHideRibbonMenuItem","aliases":["コンベヤーを隠す","KBSCE View menu: ExtrasSubmenu: :kHideRibbonMenuItem"],"executable":true,"source":"GYAHTEI.txt","id":437},
{"name":"エクストラ: テキスト連結を表示","area":"表示メニュー","shortcutText":"デフォルト: Opt+Cmd+Y","defined":true,"actionId":24332,"actionIdExpression":"0x5f00 + 12","internalName":"KBSCE View menu: ExtrasSubmenu: :Hide Te&xt Threads","aliases":["テキスト連結を隠す","テキスト連結を表示","KBSCE View menu: ExtrasSubmenu: :Hide Te&xt Threads"],"executable":true,"source":"GYAHTEI.txt","id":438},
{"name":"エクストラ: ハイパーリンクを表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":439},
{"name":"エクストラ: フレーム枠を表示","area":"表示メニュー","shortcutText":"デフォルト: Ctrl+Cmd+H","defined":true,"actionId":24331,"actionIdExpression":"0x5f00 + 11","internalName":"KBSCE View menu: ExtrasSubmenu: :Hide Frame &Edges","aliases":["フレーム枠を隠す","フレーム枠を表示","KBSCE View menu: ExtrasSubmenu: :Hide Frame &Edges"],"executable":true,"source":"GYAHTEI.txt","id":440},
{"name":"エクストラ: ライブコーナーを隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":441},
{"name":"エクストラ: リンクバッジを隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":442},
{"name":"エクストラ: 注釈を隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":443},
{"name":"オーバープリントプレビュー","area":"表示メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+Y","defined":true,"actionId":71938,"actionIdExpression":"0x11900 + 2","internalName":"KBSCE View menu:Overprint Preview","aliases":["オーバープリントプレビュー","KBSCE View menu:Overprint Preview"],"executable":true,"source":"GYAHTEI.txt","id":444},
{"name":"グリッドとガイド: ガイドにスナップ","area":"表示メニュー","shortcutText":"デフォルト: Shift+Cmd+;","defined":true,"actionId":24328,"actionIdExpression":"0x5f00 + 8","internalName":"KBSCE View menu: Grids Guides: :Snap to Gui&des","aliases":["ガイドにスナップ","KBSCE View menu: Grids Guides: :Snap to Gui&des"],"executable":true,"source":"GYAHTEI.txt","id":445},
{"name":"グリッドとガイド: ガイドをロック","area":"表示メニュー","shortcutText":"デフォルト: Opt+Cmd+;","defined":true,"actionId":24326,"actionIdExpression":"0x5f00 + 6","internalName":"KBSCE View menu: Grids Guides: :Loc&k Guides","aliases":["ガイドをロック","KBSCE View menu: Grids Guides: :Loc&k Guides"],"executable":true,"source":"GYAHTEI.txt","id":446},
{"name":"グリッドとガイド: ガイドを表示","area":"表示メニュー","shortcutText":"デフォルト: Cmd+;","defined":true,"actionId":24325,"actionIdExpression":"0x5f00 + 5","internalName":"KBSCE View menu: Grids Guides: :Hide G&uides","aliases":["ガイドを隠す","ガイドを表示","KBSCE View menu: Grids Guides: :Hide G&uides"],"executable":true,"source":"GYAHTEI.txt","id":447},
{"name":"グリッドとガイド: グリッドにスナップ","area":"表示メニュー","shortcutText":"デフォルト: Shift+Cmd+'","defined":true,"actionId":24330,"actionIdExpression":"0x5f00 + 10","internalName":"KBSCE View menu: Grids Guides: :S&nap to Document Grid","aliases":["グリッドにスナップ","KBSCE View menu: Grids Guides: :S&nap to Document Grid"],"executable":true,"source":"GYAHTEI.txt","id":448},
{"name":"グリッドとガイド: スプレッド上のすべてのガイドを削除","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":449},
{"name":"グリッドとガイド: スマートガイド","area":"表示メニュー","shortcutText":"デフォルト: Cmd+U","defined":true,"actionId":24349,"actionIdExpression":"0x5f00 + 29","internalName":"KBSCE View menu: Grids Guides: :Show &Smart Guides","aliases":["スマートガイド","KBSCE View menu: Grids Guides: :Show &Smart Guides"],"executable":true,"source":"GYAHTEI.txt","id":450},
{"name":"グリッドとガイド: ドキュメントグリッドを表示","area":"表示メニュー","shortcutText":"デフォルト: Cmd+'","defined":true,"actionId":24329,"actionIdExpression":"0x5f00 + 9","internalName":"KBSCE View menu: Grids Guides: :Show Document &Grid","aliases":["ドキュメントグリッドを表示","KBSCE View menu: Grids Guides: :Show Document &Grid"],"executable":true,"source":"GYAHTEI.txt","id":451},
{"name":"グリッドとガイド: ベースライングリッドを表示","area":"表示メニュー","shortcutText":"デフォルト: Opt+Cmd+'","defined":true,"actionId":24327,"actionIdExpression":"0x5f00 + 7","internalName":"KBSCE View menu: Grids Guides: :Show &Baseline Grid","aliases":["ベースライングリッドを表示","KBSCE View menu: Grids Guides: :Show &Baseline Grid"],"executable":true,"source":"GYAHTEI.txt","id":452},
{"name":"グリッドとガイド: 段組ガイドをロック","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":453},
{"name":"スクリーンモード: プレゼンテーション","area":"表示メニュー","shortcutText":"プレゼンテーションモード: Esc, デフォルト: Shift+W, プレゼンテーションモード: Shift+W","defined":true,"actionId":118864,"actionIdExpression":"0x1d000 + 80","internalName":"KBSCE View menu: Screen Mode: :kPresentationMenuItem","aliases":["プレゼンテーション","KBSCE View menu: Screen Mode: :kPresentationMenuItem"],"executable":true,"source":"GYAHTEI.txt","id":454},
{"name":"スクリーンモード: プレゼンテーションの背景をグレーに設定","area":"表示メニュー","shortcutText":"プレゼンテーションモード: G","defined":true,"actionId":118862,"actionIdExpression":"0x1d000 + 78","internalName":"KBSCE View menu: Screen Mode: :kPresentationBackgroundGrayMenuItem","aliases":["プレゼンテーションの背景をグレーに設定","KBSCE View menu: Screen Mode: :kPresentationBackgroundGrayMenuItem"],"executable":true,"source":"GYAHTEI.txt","id":455},
{"name":"スクリーンモード: プレゼンテーションの背景を白に設定","area":"表示メニュー","shortcutText":"プレゼンテーションモード: W","defined":true,"actionId":118863,"actionIdExpression":"0x1d000 + 79","internalName":"KBSCE View menu: Screen Mode: :kPresentationBackgroundWhiteMenuItem","aliases":["プレゼンテーションの背景を白に設定","KBSCE View menu: Screen Mode: :kPresentationBackgroundWhiteMenuItem"],"executable":true,"source":"GYAHTEI.txt","id":456},
{"name":"スクリーンモード: プレゼンテーションの背景を黒に設定","area":"表示メニュー","shortcutText":"プレゼンテーションモード: B","defined":true,"actionId":118861,"actionIdExpression":"0x1d000 + 77","internalName":"KBSCE View menu: Screen Mode: :kPresentationBackgroundBlackMenuItem","aliases":["プレゼンテーションの背景を黒に設定","KBSCE View menu: Screen Mode: :kPresentationBackgroundBlackMenuItem"],"executable":true,"source":"GYAHTEI.txt","id":457},
{"name":"スクリーンモード: プレビュー","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":458},
{"name":"スクリーンモード: 印刷可能領域モード","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":459},
{"name":"スクリーンモード: 標準モード","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":460},
{"name":"スクリーンモード: 裁ち落としモード","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":461},
{"name":"ストーリーエディター: スタイル名のコラムを隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":462},
{"name":"ストーリーエディター: 奥行き定規を隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":463},
{"name":"ストーリーエディター: 改段マークを表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":464},
{"name":"スプレッド全体","area":"表示メニュー","shortcutText":"デフォルト: Opt+Cmd+0","defined":true,"actionId":118787,"actionIdExpression":"0x1d000 + 3","internalName":"KBSCE View menu:Fit Spread In Window","aliases":["スプレッド全体","KBSCE View menu:Fit Spread In Window"],"executable":true,"source":"GYAHTEI.txt","id":465},
{"name":"ズームアウト","area":"表示メニュー","shortcutText":"デフォルト: Cmd+-, デフォルト: Cmd+Num -","defined":true,"actionId":118786,"actionIdExpression":"0x1d000 + 2","internalName":"KBSCE View menu:Zoom &Out","aliases":["ズームアウト","KBSCE View menu:Zoom &Out"],"executable":true,"source":"GYAHTEI.txt","id":466},
{"name":"ズームイン","area":"表示メニュー","shortcutText":"デフォルト: Cmd+=, デフォルト: Cmd+Num +","defined":true,"actionId":118785,"actionIdExpression":"0x1d000 + 1","internalName":"KBSCE View menu:Zoom &In","aliases":["ズームイン","KBSCE View menu:Zoom &In"],"executable":true,"source":"GYAHTEI.txt","id":467},
{"name":"ページ全体","area":"表示メニュー","shortcutText":"デフォルト: Cmd+0","defined":true,"actionId":118788,"actionIdExpression":"0x1d000 + 4","internalName":"KBSCE View menu:Fit Page In Window","aliases":["ページ全体","KBSCE View menu:Fit Page In Window"],"executable":true,"source":"GYAHTEI.txt","id":468},
{"name":"ペーストボードにテーマカラーを適用","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":469},
{"name":"ペーストボード全体","area":"表示メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+0","defined":true,"actionId":118789,"actionIdExpression":"0x1d000 + 5","internalName":"KBSCE View menu:Entire Pasteboard","aliases":["ペーストボード全体","KBSCE View menu:Entire Pasteboard"],"executable":true,"source":"GYAHTEI.txt","id":470},
{"name":"変更を隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":471},
{"name":"定規を隠す","area":"表示メニュー","shortcutText":"デフォルト: Cmd+R","defined":true,"actionId":13313,"actionIdExpression":"0x3400 + 1","internalName":"KBSCE View menu:Hide &Rulers","aliases":["定規を隠す","KBSCE View menu:Hide &Rulers"],"executable":true,"source":"GYAHTEI.txt","id":472},
{"name":"校正設定: Macintosh RGB","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":473},
{"name":"校正設定: Windows RGB","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":474},
{"name":"校正設定: カスタム...","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":475},
{"name":"校正設定: ドキュメントの CMYK スペース - Japan Color 2001 Coated","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":476},
{"name":"校正設定: モニター RGB","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":477},
{"name":"校正設定: 作業用の CMYK 領域 - Japan Color 2001 Coated","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":478},
{"name":"構造: タグマーカーを隠す","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":479},
{"name":"構造: タグ付きフレームを表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":480},
{"name":"構造: 構造を表示","area":"表示メニュー","shortcutText":"デフォルト: Opt+Cmd+1","defined":true,"actionId":78653,"actionIdExpression":"0x13300 + 61","internalName":"KBSCE View menu: Structure: :View_ShowStructure","aliases":["構造を表示","KBSCE View menu: Structure: :View_ShowStructure"],"executable":true,"source":"GYAHTEI.txt","id":481},
{"name":"色の校正","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":482},
{"name":"表示画質: オブジェクト単位の表示設定を保持","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":483},
{"name":"表示画質: オブジェクト単位の表示設定を消去","area":"表示メニュー","shortcutText":"デフォルト: Shift+Cmd+F2","defined":true,"actionId":78347,"actionIdExpression":"0x13200 + 11","internalName":"KBSCE View menu: Display Performance: :Clear Local Display Settings Menu Item","aliases":["オブジェクト単位の表示設定を消去","KBSCE View menu: Display Performance: :Clear Local Display Settings Menu Item"],"executable":true,"source":"GYAHTEI.txt","id":484},
{"name":"表示画質: 一般表示","area":"表示メニュー","shortcutText":"デフォルト: Shift+Cmd+9","defined":true,"actionId":78339,"actionIdExpression":"0x13200 + 3","internalName":"KBSCE View menu: Display Performance: :Typical Display Menu Item","aliases":["一般表示","KBSCE View menu: Display Performance: :Typical Display Menu Item"],"executable":true,"source":"GYAHTEI.txt","id":485},
{"name":"表示画質: 高品質表示","area":"表示メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+9","defined":true,"actionId":78338,"actionIdExpression":"0x13200 + 2","internalName":"KBSCE View menu: Display Performance: :High Quality Display Menu Item","aliases":["高品質表示","KBSCE View menu: Display Performance: :High Quality Display Menu Item"],"executable":true,"source":"GYAHTEI.txt","id":486},
{"name":"表示画質: 高速表示","area":"表示メニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+Z","defined":true,"actionId":78340,"actionIdExpression":"0x13200 + 4","internalName":"KBSCE View menu: Display Performance: :Optimized Display Menu Item","aliases":["高速表示","KBSCE View menu: Display Performance: :Optimized Display Menu Item"],"executable":true,"source":"GYAHTEI.txt","id":487},
{"name":"非表示のスプレッドを表示","area":"表示メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":488},
{"name":"CC ライブラリ","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":489},
{"name":"Exchange でエクステンションを検索...","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":490},
{"name":"Overlays","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":491},
{"name":"アレンジ: 2 分割表示 - 垂直方向","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":492},
{"name":"アレンジ: 2 分割表示 - 水平方向","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":493},
{"name":"アレンジ: 3 分割表示 - スタック","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":494},
{"name":"アレンジ: 3 分割表示 - 垂直方向","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":495},
{"name":"アレンジ: 3 分割表示 - 水平方向","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":496},
{"name":"アレンジ: 4 分割表示","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":497},
{"name":"アレンジ: 4 分割表示 - スタック","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":498},
{"name":"アレンジ: 4 分割表示 - 垂直方向","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":499},
{"name":"アレンジ: 4 分割表示 - 水平方向","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":500},
{"name":"アレンジ: 5 分割表示 - スタック","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":501},
{"name":"アレンジ: 6 分割表示","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":502},
{"name":"アレンジ: 6 分割表示 - スタック","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":503},
{"name":"アレンジ: 【2校0728】貝塚市OH_43期-R8_9.indd の新規ウィンドウ","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":504},
{"name":"アレンジ: すべてのウィンドウを分離","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":505},
{"name":"アレンジ: すべてのウィンドウを統合","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":506},
{"name":"アレンジ: すべてを前面へ","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":507},
{"name":"アレンジ: すべてを垂直方向に並べる","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":508},
{"name":"アレンジ: すべてを水平方向に並べる","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":509},
{"name":"アレンジ: ウィンドウを分割","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":510},
{"name":"アレンジ: ウィンドウを分離","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":511},
{"name":"アレンジ: 並べて表示","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":512},
{"name":"アレンジ: 最小化","area":"ウィンドウメニュー","shortcutText":"デフォルト: Cmd+M, デフォルト: Ctrl+Cmd+M","defined":true,"actionId":289,"actionIdExpression":"0x100 + 33","internalName":"KBSCE Window menu: Arrange: :#Minimize_Window","aliases":["最小化","KBSCE Window menu: Arrange: :#Minimize_Window"],"executable":true,"source":"GYAHTEI.txt","id":513},
{"name":"アレンジ: 重ねて表示","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":514},
{"name":"アーティクル","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":515},
{"name":"インタラクティブ: EPUB インタラクティビティプレビュー","area":"ウィンドウメニュー","shortcutText":"デフォルト: Opt+Shift+Return, デフォルト: Opt+Shift+Enter","defined":true,"actionId":134503,"actionIdExpression":"0x20d00 + 103","internalName":"KBSCE Window menu: Interactive: :.EPUB インタラクティビティプレビュー","aliases":["EPUB インタラクティビティプレビュー","KBSCE Window menu: Interactive: :.EPUB インタラクティビティプレビュー"],"executable":true,"source":"GYAHTEI.txt","id":516},
{"name":"インタラクティブ: アニメーション","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":517},
{"name":"インタラクティブ: オブジェクトステート","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":518},
{"name":"インタラクティブ: タイミング","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":519},
{"name":"インタラクティブ: ハイパーリンク","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":520},
{"name":"インタラクティブ: ブックマーク","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":521},
{"name":"インタラクティブ: ページ効果","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":522},
{"name":"インタラクティブ: ボタンとフォーム","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":523},
{"name":"インタラクティブ: メディア","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":524},
{"name":"インタラクティブ: リキッドレイアウト","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":525},
{"name":"エクステンション: JSX Timer","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":526},
{"name":"エクステンション: QRCode Maker Pro","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":527},
{"name":"エクステンション: gyogyomojier","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":528},
{"name":"エクステンション: グループ白フチちゃん","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":529},
{"name":"エクステンション: タテヨコいっぺんに整列","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":530},
{"name":"エクステンション: プロポーショナルメトリクス","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":531},
{"name":"オブジェクトとレイアウト: パスファインダー","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":532},
{"name":"オブジェクトとレイアウト: 変形","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":533},
{"name":"オブジェクトとレイアウト: 整列","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+F7","defined":true,"actionId":25857,"actionIdExpression":"0x6500 + 1","internalName":"KBSCE Window menu: Object & Layout: :Align_WinMenu","aliases":["整列","KBSCE Window menu: Object & Layout: :Align_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":534},
{"name":"カラー: カラー","area":"ウィンドウメニュー","shortcutText":"デフォルト: F6","defined":true,"actionId":29187,"actionIdExpression":"0x7200 + 3","internalName":"KBSCE Window menu: Color: :Color_WinMenu","aliases":["カラー","KBSCE Window menu: Color: :Color_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":535},
{"name":"カラー: グラデーション","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":536},
{"name":"カラー: スウォッチ","area":"ウィンドウメニュー","shortcutText":"デフォルト: F5","defined":true,"actionId":16385,"actionIdExpression":"0x4000 + 1","internalName":"KBSCE Window menu: Color: :Swatches_WinMenu","aliases":["スウォッチ","KBSCE Window menu: Color: :Swatches_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":537},
{"name":"コメント: PDF コメント","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":538},
{"name":"コンテキストタスクバー","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":539},
{"name":"コントロール","area":"ウィンドウメニュー","shortcutText":"デフォルト: Opt+Cmd+6","defined":true,"actionId":70913,"actionIdExpression":"0x11500 + 1","internalName":"KBSCE Window menu:Control Panel","aliases":["コントロール","KBSCE Window menu:Control Panel"],"executable":true,"source":"GYAHTEI.txt","id":540},
{"name":"スタイル: オブジェクトスタイル","area":"ウィンドウメニュー","shortcutText":"デフォルト: Cmd+F7","defined":true,"actionId":113153,"actionIdExpression":"0x1ba00 + 1","internalName":"KBSCE Window menu: Styles: :Object Styles","aliases":["オブジェクトスタイル","KBSCE Window menu: Styles: :Object Styles"],"executable":true,"source":"GYAHTEI.txt","id":541},
{"name":"スタイル: セルスタイル","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":542},
{"name":"スタイル: 文字スタイル","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+Cmd+F11, デフォルト: Shift+F11","defined":true,"actionId":8449,"actionIdExpression":"0x2100 + 1","internalName":"KBSCE Window menu: Styles: :CharStyles_Menu","aliases":["文字スタイル","KBSCE Window menu: Styles: :CharStyles_Menu"],"executable":true,"source":"GYAHTEI.txt","id":543},
{"name":"スタイル: 段落スタイル","area":"ウィンドウメニュー","shortcutText":"デフォルト: Cmd+F11, デフォルト: F11","defined":true,"actionId":8450,"actionIdExpression":"0x2100 + 2","internalName":"KBSCE Window menu: Styles: :ParaStyles_Menu","aliases":["段落スタイル","KBSCE Window menu: Styles: :ParaStyles_Menu"],"executable":true,"source":"GYAHTEI.txt","id":544},
{"name":"スタイル: 表スタイル","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":545},
{"name":"ツール","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":546},
{"name":"テキストの回り込み","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":547},
{"name":"ヒストリー","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":548},
{"name":"プロパティ","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":549},
{"name":"ページ","area":"ウィンドウメニュー","shortcutText":"デフォルト: Cmd+F12, デフォルト: F12","defined":true,"actionId":6145,"actionIdExpression":"0x1800 + 1","internalName":"KBSCE Window menu:Pages_WinMenu","aliases":["ページ","KBSCE Window menu:Pages_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":550},
{"name":"ユーティリティ: スクリプト","area":"ウィンドウメニュー","shortcutText":"デフォルト: Opt+Cmd+F11","defined":true,"actionId":52224,"actionIdExpression":"0xcc00 + 0","internalName":"KBSCE Window menu: Utilities: :WindowsMenuScriptsPanelItem","aliases":["スクリプト","KBSCE Window menu: Utilities: :WindowsMenuScriptsPanelItem"],"executable":true,"source":"GYAHTEI.txt","id":551},
{"name":"ユーティリティ: スクリプトラベル","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":552},
{"name":"ユーティリティ: タグ","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":553},
{"name":"ユーティリティ: データ結合","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":554},
{"name":"ユーティリティ: バックグラウンドタスク","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":555},
{"name":"リンク","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+Cmd+D","defined":true,"actionId":132609,"actionIdExpression":"0x20600 + 1","internalName":"KBSCE Window menu:Links_WinMenu","aliases":["リンク","KBSCE Window menu:Links_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":556},
{"name":"レイヤー","area":"ウィンドウメニュー","shortcutText":"デフォルト: F7","defined":true,"actionId":18433,"actionIdExpression":"0x4800 + 1","internalName":"KBSCE Window menu:Layers_WinMenu","aliases":["レイヤー","KBSCE Window menu:Layers_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":557},
{"name":"ワークスペース: 1 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":558},
{"name":"ワークスペース: 1 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":559},
{"name":"ワークスペース: 2 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":560},
{"name":"ワークスペース: 2 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":561},
{"name":"ワークスペース: 20260730-gyahteiをリセット","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":562},
{"name":"ワークスペース: 3 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":563},
{"name":"ワークスペース: 3 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":564},
{"name":"ワークスペース: 4 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":565},
{"name":"ワークスペース: 4 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":566},
{"name":"ワークスペース: 5 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":567},
{"name":"ワークスペース: 5 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":568},
{"name":"ワークスペース: 6 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":569},
{"name":"ワークスペース: 6 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":570},
{"name":"ワークスペース: 7 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":571},
{"name":"ワークスペース: 7 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":572},
{"name":"ワークスペース: 8 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":573},
{"name":"ワークスペース: 8 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":574},
{"name":"ワークスペース: 9 番目のデフォルトワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":575},
{"name":"ワークスペース: 9 番目のユーザーワークスペースを読み込む","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":576},
{"name":"ワークスペース: メニュー項目をすべて表示","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":577},
{"name":"ワークスペース: ワークスペースを削除...","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":578},
{"name":"ワークスペース: 新規ワークスペース...","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":579},
{"name":"出力: トラッププリセット","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":580},
{"name":"出力: プリフライト","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":581},
{"name":"出力: プリント属性","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":582},
{"name":"出力: 分版プレビュー","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+F6","defined":true,"actionId":71937,"actionIdExpression":"0x11900 + 1","internalName":"KBSCE Window menu: Output: :SepPrv_Submenu","aliases":["分版プレビュー","KBSCE Window menu: Output: :SepPrv_Submenu"],"executable":true,"source":"GYAHTEI.txt","id":583},
{"name":"出力: 透明の分割・統合","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":584},
{"name":"効果","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+Cmd+F10","defined":true,"actionId":67841,"actionIdExpression":"0x10900 + 1","internalName":"KBSCE Window menu:Transparency_WinMenu","aliases":["効果","KBSCE Window menu:Transparency_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":585},
{"name":"情報","area":"ウィンドウメニュー","shortcutText":"デフォルト: F8","defined":true,"actionId":89089,"actionIdExpression":"0x15c00 + 1","internalName":"KBSCE Window menu:Info_WinMenu","aliases":["情報","KBSCE Window menu:Info_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":586},
{"name":"数式","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":587},
{"name":"書式と表: グリッドフォーマット","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":588},
{"name":"書式と表: ストーリー","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":589},
{"name":"書式と表: 字形","area":"ウィンドウメニュー","shortcutText":"デフォルト: Opt+Shift+F11","defined":true,"actionId":53505,"actionIdExpression":"0xd100 + 1","internalName":"KBSCE Window menu: Type & Tables: :&Insert Glyphs_menu","aliases":["字形","KBSCE Window menu: Type & Tables: :&Insert Glyphs_menu"],"executable":true,"source":"GYAHTEI.txt","id":590},
{"name":"書式と表: 文字","area":"ウィンドウメニュー","shortcutText":"デフォルト: Cmd+T","defined":true,"actionId":26896,"actionIdExpression":"0x6900 + 16","internalName":"KBSCE Window menu: Type & Tables: :&Character_menu","aliases":["文字","KBSCE Window menu: Type & Tables: :&Character_menu"],"executable":true,"source":"GYAHTEI.txt","id":591},
{"name":"書式と表: 条件テキスト","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":592},
{"name":"書式と表: 段落","area":"ウィンドウメニュー","shortcutText":"デフォルト: Opt+Cmd+T","defined":true,"actionId":27144,"actionIdExpression":"0x6a00 + 8","internalName":"KBSCE Window menu: Type & Tables: :&Paragraph_menu","aliases":["段落","KBSCE Window menu: Type & Tables: :&Paragraph_menu"],"executable":true,"source":"GYAHTEI.txt","id":593},
{"name":"書式と表: 相互参照","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":594},
{"name":"書式と表: 索引","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+F8","defined":true,"actionId":78081,"actionIdExpression":"0x13100 + 1","internalName":"KBSCE Window menu: Type & Tables: :Index_WinMenu","aliases":["索引","KBSCE Window menu: Type & Tables: :Index_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":595},
{"name":"書式と表: 表","area":"ウィンドウメニュー","shortcutText":"デフォルト: Shift+F9","defined":true,"actionId":66878,"actionIdExpression":"0x10500 + 62","internalName":"KBSCE Window menu: Type & Tables: :Table_WinMenu","aliases":["表","KBSCE Window menu: Type & Tables: :Table_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":596},
{"name":"線","area":"ウィンドウメニュー","shortcutText":"デフォルト: Cmd+F10, デフォルト: F10","defined":true,"actionId":11011,"actionIdExpression":"0x2b00 + 3","internalName":"KBSCE Window menu:Stroke_WinMenu","aliases":["線","KBSCE Window menu:Stroke_WinMenu"],"executable":true,"source":"GYAHTEI.txt","id":597},
{"name":"編集関連: アサイン","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":598},
{"name":"編集関連: 変更をトラック","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":599},
{"name":"編集関連: 注釈","area":"ウィンドウメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":600},
{"name":"InDesign オンライン...","area":"ヘルプメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":601},
{"name":"InDesign チュートリアル...","area":"ヘルプメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":602},
{"name":"InDesign フォーラム...","area":"ヘルプメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":603},
{"name":"InDesign ヘルプ...","area":"ヘルプメニュー","shortcutText":"デフォルト: ヘルプ","defined":true,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":604},
{"name":"バグを送信／機能改善のリクエスト...","area":"ヘルプメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":605},
{"name":"生成 AI ユーザーガイドライン","area":"ヘルプメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":606},
{"name":"生成クレジットについて...","area":"ヘルプメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":607},
{"name":"ヒストリー: 1 段階戻る","area":"Panel Menus","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":608},
{"name":"ヒストリー: 1 段階進む","area":"Panel Menus","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":609},
{"name":"ヒストリー: ヒストリーを消去","area":"Panel Menus","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":610},
{"name":"ヒストリー: 削除","area":"Panel Menus","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":611},
{"name":"ヒストリー: 新規ドキュメント","area":"Panel Menus","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":612},
{"name":"1% サイズ増加","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":613},
{"name":"1% サイズ減少","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":614},
{"name":"1% 比率増加","area":"オブジェクト編集","shortcutText":"デフォルト: Cmd+.","defined":true,"actionId":11298,"actionIdExpression":"0x2c00 + 34","internalName":"KBSCE Object editing:Increase object scale","aliases":["1% 比率増加","KBSCE Object editing:Increase object scale"],"executable":true,"source":"GYAHTEI.txt","id":615},
{"name":"1% 比率減少","area":"オブジェクト編集","shortcutText":"デフォルト: Cmd+,","defined":true,"actionId":11299,"actionIdExpression":"0x2c00 + 35","internalName":"KBSCE Object editing:Decrease object scale","aliases":["1% 比率減少","KBSCE Object editing:Decrease object scale"],"executable":true,"source":"GYAHTEI.txt","id":616},
{"name":"10 倍上にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+上向き矢印","defined":true,"actionId":429,"actionIdExpression":"0x100 + 173","internalName":"KBSCE Object editing:Nudge up x10","aliases":["10 倍上にずらす","KBSCE Object editing:Nudge up x10"],"executable":true,"source":"GYAHTEI.txt","id":617},
{"name":"10 倍下にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+下向き矢印","defined":true,"actionId":430,"actionIdExpression":"0x100 + 174","internalName":"KBSCE Object editing:Nudge down x10","aliases":["10 倍下にずらす","KBSCE Object editing:Nudge down x10"],"executable":true,"source":"GYAHTEI.txt","id":618},
{"name":"10 倍右にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+右向き矢印","defined":true,"actionId":432,"actionIdExpression":"0x100 + 176","internalName":"KBSCE Object editing:Nudge right x10","aliases":["10 倍右にずらす","KBSCE Object editing:Nudge right x10"],"executable":true,"source":"GYAHTEI.txt","id":619},
{"name":"10 倍左にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+左向き矢印","defined":true,"actionId":431,"actionIdExpression":"0x100 + 175","internalName":"KBSCE Object editing:Nudge left x10","aliases":["10 倍左にずらす","KBSCE Object editing:Nudge left x10"],"executable":true,"source":"GYAHTEI.txt","id":620},
{"name":"10 分の 1 上にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+Cmd+上向き矢印","defined":true,"actionId":425,"actionIdExpression":"0x100 + 169","internalName":"KBSCE Object editing:Nudge up 1/10","aliases":["10 分の 1 上にずらす","KBSCE Object editing:Nudge up 1/10"],"executable":true,"source":"GYAHTEI.txt","id":621},
{"name":"10 分の 1 下にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+Cmd+下向き矢印","defined":true,"actionId":426,"actionIdExpression":"0x100 + 170","internalName":"KBSCE Object editing:Nudge down 1/10","aliases":["10 分の 1 下にずらす","KBSCE Object editing:Nudge down 1/10"],"executable":true,"source":"GYAHTEI.txt","id":622},
{"name":"10 分の 1 右にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+Cmd+右向き矢印","defined":true,"actionId":428,"actionIdExpression":"0x100 + 172","internalName":"KBSCE Object editing:Nudge right 1/10","aliases":["10 分の 1 右にずらす","KBSCE Object editing:Nudge right 1/10"],"executable":true,"source":"GYAHTEI.txt","id":623},
{"name":"10 分の 1 左にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+Cmd+左向き矢印","defined":true,"actionId":427,"actionIdExpression":"0x100 + 171","internalName":"KBSCE Object editing:Nudge left 1/10","aliases":["10 分の 1 左にずらす","KBSCE Object editing:Nudge left 1/10"],"executable":true,"source":"GYAHTEI.txt","id":624},
{"name":"5% サイズ増加","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":625},
{"name":"5% サイズ減少","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":626},
{"name":"5% 比率増加","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+.","defined":true,"actionId":11300,"actionIdExpression":"0x2c00 + 36","internalName":"KBSCE Object editing:Increase object scale x 5","aliases":["5% 比率増加","KBSCE Object editing:Increase object scale x 5"],"executable":true,"source":"GYAHTEI.txt","id":627},
{"name":"5% 比率減少","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+,","defined":true,"actionId":11301,"actionIdExpression":"0x2c00 + 37","internalName":"KBSCE Object editing:Decrease object scale x 5","aliases":["5% 比率減少","KBSCE Object editing:Decrease object scale x 5"],"executable":true,"source":"GYAHTEI.txt","id":628},
{"name":"すべてのガイドを選択","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+G","defined":true,"actionId":118833,"actionIdExpression":"0x1d000 + 49","internalName":"KBSCE Object editing:Select All Guides","aliases":["すべてのガイドを選択","KBSCE Object editing:Select All Guides"],"executable":true,"source":"GYAHTEI.txt","id":629},
{"name":"ゾーンガイド","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":630},
{"name":"パスの描写を終了","area":"オブジェクト編集","shortcutText":"デフォルト: Enter, デフォルト: Return","defined":true,"actionId":99622,"actionIdExpression":"0x18500 + 38","internalName":"KBSCE Object editing:End Path Drawing","aliases":["パスの描写を終了","KBSCE Object editing:End Path Drawing"],"executable":true,"source":"GYAHTEI.txt","id":631},
{"name":"ポイントを削除","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":632},
{"name":"マグネットガイド","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":633},
{"name":"ライブ編集モードの切り替え","area":"オブジェクト編集","shortcutText":"デフォルト: 4","defined":true,"actionId":118858,"actionIdExpression":"0x1d000 + 74","internalName":"KBSCE Object editing:kToggleLiveEditingMode","aliases":["ライブ編集モードの切り替え","KBSCE Object editing:kToggleLiveEditingMode"],"executable":true,"source":"GYAHTEI.txt","id":634},
{"name":"リキッドガイド","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":635},
{"name":"上にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: 上向き矢印","defined":true,"actionId":280,"actionIdExpression":"0x100 + 24","internalName":"KBSCE Object editing:Nudge up","aliases":["上にずらす","KBSCE Object editing:Nudge up"],"executable":true,"source":"GYAHTEI.txt","id":636},
{"name":"上端に固定","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+上向き矢印","defined":true,"actionId":24364,"actionIdExpression":"0x5f00 + 44","internalName":"KBSCE Object editing:kObjectConstraintMenuString_PinTop","aliases":["上端に固定","KBSCE Object editing:kObjectConstraintMenuString_PinTop"],"executable":true,"source":"GYAHTEI.txt","id":637},
{"name":"下にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: 下向き矢印","defined":true,"actionId":281,"actionIdExpression":"0x100 + 25","internalName":"KBSCE Object editing:Nudge down","aliases":["下にずらす","KBSCE Object editing:Nudge down"],"executable":true,"source":"GYAHTEI.txt","id":638},
{"name":"下端に固定","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+下向き矢印","defined":true,"actionId":24365,"actionIdExpression":"0x5f00 + 45","internalName":"KBSCE Object editing:kObjectConstraintMenuString_PinBottom","aliases":["下端に固定","KBSCE Object editing:kObjectConstraintMenuString_PinBottom"],"executable":true,"source":"GYAHTEI.txt","id":639},
{"name":"右にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: 右向き矢印","defined":true,"actionId":283,"actionIdExpression":"0x100 + 27","internalName":"KBSCE Object editing:Nudge right","aliases":["右にずらす","KBSCE Object editing:Nudge right"],"executable":true,"source":"GYAHTEI.txt","id":640},
{"name":"右端に固定","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+右向き矢印","defined":true,"actionId":24361,"actionIdExpression":"0x5f00 + 41","internalName":"KBSCE Object editing:kObjectConstraintMenuString_PinRight","aliases":["右端に固定","KBSCE Object editing:kObjectConstraintMenuString_PinRight"],"executable":true,"source":"GYAHTEI.txt","id":641},
{"name":"垂直スプレッドの上揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":642},
{"name":"垂直スプレッドの下揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":643},
{"name":"垂直スプレッドの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":644},
{"name":"垂直ページの上揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":645},
{"name":"垂直ページの下揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":646},
{"name":"垂直ページの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":647},
{"name":"垂直マージンの上揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":648},
{"name":"垂直マージンの下揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":649},
{"name":"垂直マージンの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":650},
{"name":"垂直方向にサイズ変更","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+V","defined":true,"actionId":24368,"actionIdExpression":"0x5f00 + 48","internalName":"KBSCE Object editing:kObjectConstraintMenuString_ResizeVertically","aliases":["垂直方向にサイズ変更","KBSCE Object editing:kObjectConstraintMenuString_ResizeVertically"],"executable":true,"source":"GYAHTEI.txt","id":651},
{"name":"垂直方向上に分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":652},
{"name":"垂直方向上揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":653},
{"name":"垂直方向下に分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":654},
{"name":"垂直方向下揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":655},
{"name":"垂直方向中央に分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":656},
{"name":"垂直方向中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":657},
{"name":"垂直方向等間隔に分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":658},
{"name":"垂直裁ち落としの上揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":659},
{"name":"垂直裁ち落としの下揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":660},
{"name":"垂直裁ち落としの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":661},
{"name":"定規ガイド","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":662},
{"name":"左にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: 左向き矢印","defined":true,"actionId":282,"actionIdExpression":"0x100 + 26","internalName":"KBSCE Object editing:Nudge left","aliases":["左にずらす","KBSCE Object editing:Nudge left"],"executable":true,"source":"GYAHTEI.txt","id":663},
{"name":"左端に固定","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Cmd+左向き矢印","defined":true,"actionId":24360,"actionIdExpression":"0x5f00 + 40","internalName":"KBSCE Object editing:kObjectConstraintMenuString_PinLeft","aliases":["左端に固定","KBSCE Object editing:kObjectConstraintMenuString_PinLeft"],"executable":true,"source":"GYAHTEI.txt","id":664},
{"name":"水平スプレッドの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":665},
{"name":"水平スプレッドの右揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":666},
{"name":"水平スプレッドの左揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":667},
{"name":"水平ページの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":668},
{"name":"水平ページの右揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":669},
{"name":"水平ページの左揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":670},
{"name":"水平マージンの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":671},
{"name":"水平マージンの右揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":672},
{"name":"水平マージンの左揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":673},
{"name":"水平方向にサイズ変更","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+H","defined":true,"actionId":24367,"actionIdExpression":"0x5f00 + 47","internalName":"KBSCE Object editing:kObjectConstraintMenuString_ResizeHorizontally","aliases":["水平方向にサイズ変更","KBSCE Object editing:kObjectConstraintMenuString_ResizeHorizontally"],"executable":true,"source":"GYAHTEI.txt","id":674},
{"name":"水平方向の中央分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":675},
{"name":"水平方向の右分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":676},
{"name":"水平方向の左分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":677},
{"name":"水平方向中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":678},
{"name":"水平方向右揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":679},
{"name":"水平方向左揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":680},
{"name":"水平方向等間隔に分布","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":681},
{"name":"水平裁ち落としの中央揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":682},
{"name":"水平裁ち落としの右揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":683},
{"name":"水平裁ち落としの左揃え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":684},
{"name":"自動調整の切り替え","area":"オブジェクト編集","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":685},
{"name":"複製を 10 倍上にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+上向き矢印","defined":true,"actionId":465,"actionIdExpression":"0x100 + 209","internalName":"KBSCE Object editing:Nudge up x10 duplicate","aliases":["複製を 10 倍上にずらす","KBSCE Object editing:Nudge up x10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":686},
{"name":"複製を 10 倍下にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+下向き矢印","defined":true,"actionId":466,"actionIdExpression":"0x100 + 210","internalName":"KBSCE Object editing:Nudge down x10 duplicate","aliases":["複製を 10 倍下にずらす","KBSCE Object editing:Nudge down x10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":687},
{"name":"複製を 10 倍右にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+右向き矢印","defined":true,"actionId":468,"actionIdExpression":"0x100 + 212","internalName":"KBSCE Object editing:Nudge right x10 duplicate","aliases":["複製を 10 倍右にずらす","KBSCE Object editing:Nudge right x10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":688},
{"name":"複製を 10 倍左にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+左向き矢印","defined":true,"actionId":467,"actionIdExpression":"0x100 + 211","internalName":"KBSCE Object editing:Nudge left x10 duplicate","aliases":["複製を 10 倍左にずらす","KBSCE Object editing:Nudge left x10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":689},
{"name":"複製を 10 分の 1 上にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+Cmd+上向き矢印","defined":true,"actionId":461,"actionIdExpression":"0x100 + 205","internalName":"KBSCE Object editing:Nudge up 1/10 duplicate","aliases":["複製を 10 分の 1 上にずらす","KBSCE Object editing:Nudge up 1/10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":690},
{"name":"複製を 10 分の 1 下にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+Cmd+下向き矢印","defined":true,"actionId":462,"actionIdExpression":"0x100 + 206","internalName":"KBSCE Object editing:Nudge down 1/10 duplicate","aliases":["複製を 10 分の 1 下にずらす","KBSCE Object editing:Nudge down 1/10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":691},
{"name":"複製を 10 分の 1 右にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+Cmd+右向き矢印","defined":true,"actionId":464,"actionIdExpression":"0x100 + 208","internalName":"KBSCE Object editing:Nudge right 1/10 duplicate","aliases":["複製を 10 分の 1 右にずらす","KBSCE Object editing:Nudge right 1/10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":692},
{"name":"複製を 10 分の 1 左にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+Shift+Cmd+左向き矢印","defined":true,"actionId":463,"actionIdExpression":"0x100 + 207","internalName":"KBSCE Object editing:Nudge left 1/10 duplicate","aliases":["複製を 10 分の 1 左にずらす","KBSCE Object editing:Nudge left 1/10 duplicate"],"executable":true,"source":"GYAHTEI.txt","id":693},
{"name":"複製を上にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+上向き矢印","defined":true,"actionId":457,"actionIdExpression":"0x100 + 201","internalName":"KBSCE Object editing:Nudge up duplicate","aliases":["複製を上にずらす","KBSCE Object editing:Nudge up duplicate"],"executable":true,"source":"GYAHTEI.txt","id":694},
{"name":"複製を下にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+下向き矢印","defined":true,"actionId":458,"actionIdExpression":"0x100 + 202","internalName":"KBSCE Object editing:Nudge down duplicate","aliases":["複製を下にずらす","KBSCE Object editing:Nudge down duplicate"],"executable":true,"source":"GYAHTEI.txt","id":695},
{"name":"複製を右にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+右向き矢印","defined":true,"actionId":460,"actionIdExpression":"0x100 + 204","internalName":"KBSCE Object editing:Nudge right duplicate","aliases":["複製を右にずらす","KBSCE Object editing:Nudge right duplicate"],"executable":true,"source":"GYAHTEI.txt","id":696},
{"name":"複製を左にずらす","area":"オブジェクト編集","shortcutText":"デフォルト: Opt+左向き矢印","defined":true,"actionId":459,"actionIdExpression":"0x100 + 203","internalName":"KBSCE Object editing:Nudge left duplicate","aliases":["複製を左にずらす","KBSCE Object editing:Nudge left duplicate"],"executable":true,"source":"GYAHTEI.txt","id":697},
{"name":"アプリケーション","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":698},
{"name":"アプリケーション: Indic Preferences.js","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":699},
{"name":"アプリケーション: Samples","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":700},
{"name":"アプリケーション: Samples: AppleScript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":701},
{"name":"アプリケーション: Samples: AppleScript: AddGuides.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":702},
{"name":"アプリケーション: Samples: AppleScript: AddPoints.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":703},
{"name":"アプリケーション: Samples: AppleScript: AdjustPageItems.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":704},
{"name":"アプリケーション: Samples: AppleScript: AlignToPage.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":705},
{"name":"アプリケーション: Samples: AppleScript: AnimationEncyclopedia.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":706},
{"name":"アプリケーション: Samples: AppleScript: BreakFrame.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":707},
{"name":"アプリケーション: Samples: AppleScript: CornerEffects.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":708},
{"name":"アプリケーション: Samples: AppleScript: CreateCharacterStyle.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":709},
{"name":"アプリケーション: Samples: AppleScript: CropMarks.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":710},
{"name":"アプリケーション: Samples: AppleScript: ExportAllStories.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":711},
{"name":"アプリケーション: Samples: AppleScript: FindChangeByList.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":712},
{"name":"アプリケーション: Samples: AppleScript: FindChangeSupport","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":713},
{"name":"アプリケーション: Samples: AppleScript: ImageCatalog.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":714},
{"name":"アプリケーション: Samples: AppleScript: MakeGrid.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":715},
{"name":"アプリケーション: Samples: AppleScript: Neon.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":716},
{"name":"アプリケーション: Samples: AppleScript: PathEffects.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":717},
{"name":"アプリケーション: Samples: AppleScript: PlaceMultipagePDF.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":718},
{"name":"アプリケーション: Samples: AppleScript: SelectObjects.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":719},
{"name":"アプリケーション: Samples: AppleScript: SortParagraphs.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":720},
{"name":"アプリケーション: Samples: AppleScript: SplitStory.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":721},
{"name":"アプリケーション: Samples: AppleScript: TabUtilities.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":722},
{"name":"アプリケーション: Samples: JavaScript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":723},
{"name":"アプリケーション: Samples: JavaScript: AddGuides.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":724},
{"name":"アプリケーション: Samples: JavaScript: AddPoints.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":725},
{"name":"アプリケーション: Samples: JavaScript: AddQRCode.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":726},
{"name":"アプリケーション: Samples: JavaScript: AdjustPageItems.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":727},
{"name":"アプリケーション: Samples: JavaScript: AlignToPage.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":728},
{"name":"アプリケーション: Samples: JavaScript: AnimationEncyclopedia.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":729},
{"name":"アプリケーション: Samples: JavaScript: BreakFrame.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":730},
{"name":"アプリケーション: Samples: JavaScript: CornerEffects.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":731},
{"name":"アプリケーション: Samples: JavaScript: CreateCharacterStyle.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":732},
{"name":"アプリケーション: Samples: JavaScript: CropMarks.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":733},
{"name":"アプリケーション: Samples: JavaScript: ExportAllStories.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":734},
{"name":"アプリケーション: Samples: JavaScript: FindChangeByList.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":735},
{"name":"アプリケーション: Samples: JavaScript: FindChangeSupport","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":736},
{"name":"アプリケーション: Samples: JavaScript: ImageCatalog.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":737},
{"name":"アプリケーション: Samples: JavaScript: MakeGrid.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":738},
{"name":"アプリケーション: Samples: JavaScript: Neon.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":739},
{"name":"アプリケーション: Samples: JavaScript: PathEffects.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":740},
{"name":"アプリケーション: Samples: JavaScript: PlaceMultipagePDF.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":741},
{"name":"アプリケーション: Samples: JavaScript: SelectObjects.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":742},
{"name":"アプリケーション: Samples: JavaScript: SortParagraphs.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":743},
{"name":"アプリケーション: Samples: JavaScript: SplitStory.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":744},
{"name":"アプリケーション: Samples: JavaScript: TabUtilities.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":745},
{"name":"アプリケーション: Samples: UXPScript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":746},
{"name":"アプリケーション: Samples: UXPScript: AddGuides.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":747},
{"name":"アプリケーション: Samples: UXPScript: AddPoints.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":748},
{"name":"アプリケーション: Samples: UXPScript: AddQRCode.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":749},
{"name":"アプリケーション: Samples: UXPScript: AdjustPageItems.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":750},
{"name":"アプリケーション: Samples: UXPScript: AlignToPage.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":751},
{"name":"アプリケーション: Samples: UXPScript: AnimationEncyclopedia.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":752},
{"name":"アプリケーション: Samples: UXPScript: BreakFrame.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":753},
{"name":"アプリケーション: Samples: UXPScript: CornerEffects.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":754},
{"name":"アプリケーション: Samples: UXPScript: CreateCharacterStyle.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":755},
{"name":"アプリケーション: Samples: UXPScript: CropMarks.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":756},
{"name":"アプリケーション: Samples: UXPScript: ExportAllStories.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":757},
{"name":"アプリケーション: Samples: UXPScript: ImageCatalog.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":758},
{"name":"アプリケーション: Samples: UXPScript: MakeGrid.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":759},
{"name":"アプリケーション: Samples: UXPScript: Neon.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":760},
{"name":"アプリケーション: Samples: UXPScript: PathEffects.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":761},
{"name":"アプリケーション: Samples: UXPScript: SelectObjects.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":762},
{"name":"アプリケーション: Samples: UXPScript: SortParagraphs.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":763},
{"name":"アプリケーション: Samples: UXPScript: SplitStory.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":764},
{"name":"アプリケーション: Samples: UXPScript: TabUtilities.idjs","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":765},
{"name":"コミュニティ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":766},
{"name":"コミュニティ: BreakTextThread.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":767},
{"name":"コミュニティ: ClearStyleOverrides.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":768},
{"name":"コミュニティ: InsertTypographerQuote","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":769},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Double_CH.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":770},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Double_DE.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":771},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Double_EN.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":772},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Double_FR.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":773},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Single_CH.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":774},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Single_DE.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":775},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Single_EN.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":776},
{"name":"コミュニティ: InsertTypographerQuote: InsertTypographerQuote_Single_FR.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":777},
{"name":"コミュニティ: SnapMarginsToTextFrame.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":778},
{"name":"コミュニティ: UnicodeInjector.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":779},
{"name":"ユーザー","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":780},
{"name":"ユーザー: 00_使う時に気をつけるやつ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":781},
{"name":"ユーザー: 00_使う時に気をつけるやつ: InDesignフレーム調整オプションを 全ページから一括消去.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":782},
{"name":"ユーザー: 00_使う時に気をつけるやつ: ObjectStyle_TransparencyInspector.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":783},
{"name":"ユーザー: 00_使う時に気をつけるやつ: オブジェクトスタイルのチェックを全部オフるやつ.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":784},
{"name":"ユーザー: 00_使う時に気をつけるやつ: オーバーライドをぜんぶけすやつ-clearOverrides.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":785},
{"name":"ユーザー: 00_使う時に気をつけるやつ: カーニングを変えるやつ-Replace_KerningMethod_By_Select.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":786},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 全ての合成フォントを削除する_ChatGPT.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":787},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 単数行コンポーザーに変更.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":788},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 合成フォント全削除.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":789},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 指定ページへ見開き単位でペースト-Paste_To_Specified_Spreads.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":790},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 文字組アキ量設定を変えるやつ-Replace_Mojikumi_By_Select.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":791},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 正規表現スタイルを基準段落スタイルの内容にリセット-resetNestedGrepStyles_250828f.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":792},
{"name":"ユーザー: 00_使う時に気をつけるやつ: 行送りの基準位置を一括変更-Change_LeadingModel.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":793},
{"name":"ユーザー: 01","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":794},
{"name":"ユーザー: 01: 00全レイヤーロック.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":795},
{"name":"ユーザー: 01: 0全レイヤーロック.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":796},
{"name":"ユーザー: 01: alignAndDistribute_=0mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":797},
{"name":"ユーザー: 01: アラートダイアログがでなくなった時.applescript","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":798},
{"name":"ユーザー: 01: ダイアログが出ない.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":799},
{"name":"ユーザー: 01: 画像に名前を表示","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":800},
{"name":"ユーザー: 01: 画像に名前を表示: 画像に名前を表示-ImageFileNameID.scptd","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":801},
{"name":"ユーザー: 01: 選択ハニー3部作","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":802},
{"name":"ユーザー: 01: 選択ハニー3部作: SelectionExpander","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":803},
{"name":"ユーザー: 01: 選択ハニー3部作: SelectionExpander: SelectionExpander.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":804},
{"name":"ユーザー: 01: 選択ハニー3部作: StoryFixer","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":805},
{"name":"ユーザー: 01: 選択ハニー3部作: StoryFixer: StoryFixer.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":806},
{"name":"ユーザー: 01: 選択ハニー3部作: gyogyomer","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":807},
{"name":"ユーザー: 01: 選択ハニー3部作: gyogyomer: gyogyomer.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":808},
{"name":"ユーザー: 02_表組","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":809},
{"name":"ユーザー: 02_表組: 22-表組","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":810},
{"name":"ユーザー: 02_表組: 22-表組: TableCellSizeMatcher.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":811},
{"name":"ユーザー: 02_表組: 22-表組: TableColumnWidthPanel.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":812},
{"name":"ユーザー: 02_表組: 22-表組: TableLineHelper.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":813},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":814},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 20260706","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":815},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 20260706: TableLineHelper.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":816},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 20260718","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":817},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 20260718: TableLineHelper-.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":818},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 20260718: TableLineHelper.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":819},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableCellSizeMatcher.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":820},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.10.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":821},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.11.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":822},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.2.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":823},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.3-diagnostic.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":824},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.4.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":825},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.5.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":826},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.6.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":827},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.7.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":828},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.8.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":829},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: TableLineHelper-v1.0.9.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":830},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 表組の罫線","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":831},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 表組の罫線: SmartBorderBuilder.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":832},
{"name":"ユーザー: 02_表組: 22-表組: 名称未設定フォルダ: 表組の罫線: 罫線の設定.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":833},
{"name":"ユーザー: 02_表組: CopyCells v001.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":834},
{"name":"ユーザー: 02_表組: Excelからセルへ流し込み","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":835},
{"name":"ユーザー: 02_表組: Excel選択セルをInDesign表へ流し込み.scpt","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":836},
{"name":"ユーザー: 02_表組: [ corecara ] 簡易ID表組変換.scpt","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":837},
{"name":"ユーザー: 02_表組: セル結合ID","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":838},
{"name":"ユーザー: 02_表組: セル結合ID: セル結合ID.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":839},
{"name":"ユーザー: 02_表組: セル調整","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":840},
{"name":"ユーザー: 02_表組: セル調整: セルの幅.js","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":841},
{"name":"ユーザー: 02_表組: セル調整: セルの高さ.js","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":842},
{"name":"ユーザー: 02_表組: セル調整: セル調整.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":843},
{"name":"ユーザー: 02_表組: セル調整: セル高さ最大値のリセット.js","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":844},
{"name":"ユーザー: 02_表組: 保留","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":845},
{"name":"ユーザー: 02_表組: 数値指定で表全体のサイズを変更する_v100.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":846},
{"name":"ユーザー: 02_表組: 表のオーバーフローに長体.js","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":847},
{"name":"ユーザー: 02_表組: 表を丸める.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":848},
{"name":"ユーザー: 03_テキスト関係","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":849},
{"name":"ユーザー: 03_テキスト関係: 1桁全角2桁以上半角","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":850},
{"name":"ユーザー: 03_テキスト関係: 1桁全角2桁以上半角: 1桁全角2桁以上半角.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":851},
{"name":"ユーザー: 03_テキスト関係: 1行におさめる","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":852},
{"name":"ユーザー: 03_テキスト関係: 1行におさめる: 1行におさめる.scpt","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":853},
{"name":"ユーザー: 03_テキスト関係: Break-Text-Thread-master","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":854},
{"name":"ユーザー: 03_テキスト関係: Break-Text-Thread-master: BreakTextThreadVersion1.0.1.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":855},
{"name":"ユーザー: 03_テキスト関係: exchangeString_a_and_b","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":856},
{"name":"ユーザー: 03_テキスト関係: exchangeString_a_and_b: exchangeString_a_and_b.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":857},
{"name":"ユーザー: 03_テキスト関係: インラインのアンカー付きオブジェクトを行の中央に揃える_v110","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":858},
{"name":"ユーザー: 03_テキスト関係: インラインのアンカー付きオブジェクトを行の中央に揃える_v110: インラインのアンカー付きオブジェクトを行の中央に揃える_v110.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":859},
{"name":"ユーザー: 03_テキスト関係: スペースの種類-id_spaceName","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":860},
{"name":"ユーザー: 03_テキスト関係: スペースの種類-id_spaceName: スペースの種類-id_spaceName.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":861},
{"name":"ユーザー: 03_テキスト関係: タテヨコ変換_id_orientationSwitcher.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":862},
{"name":"ユーザー: 03_テキスト関係: タブ位置全部ずらすやつ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":863},
{"name":"ユーザー: 03_テキスト関係: タブ位置全部ずらすやつ: タブ位置全部ずらすやつ-id_tabStopShifter.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":864},
{"name":"ユーザー: 03_テキスト関係: テキストフレーム分離.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":865},
{"name":"ユーザー: 03_テキスト関係: テキストフレーム連結.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":866},
{"name":"ユーザー: 03_テキスト関係: テキストボックスにフィット-長体平体.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":867},
{"name":"ユーザー: 03_テキスト関係: プレーンテキストフレームのサイズをベタ組にする_v100.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":868},
{"name":"ユーザー: 03_テキスト関係: フォント置換ID_Dessertsles.scpt","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":869},
{"name":"ユーザー: 03_テキスト関係: ルビ_Wordコピペ.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":870},
{"name":"ユーザー: 03_テキスト関係: 丸数字とかにする","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":871},
{"name":"ユーザー: 03_テキスト関係: 丸数字とかにする: round_num.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":872},
{"name":"ユーザー: 03_テキスト関係: 再変換くん","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":873},
{"name":"ユーザー: 03_テキスト関係: 再変換くん: id_rechangeText_pr.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":874},
{"name":"ユーザー: 03_テキスト関係: 再変換さん","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":875},
{"name":"ユーザー: 03_テキスト関係: 再変換さん: 再変換さん.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":876},
{"name":"ユーザー: 03_テキスト関係: 右揃えだけど一番長い行が中央揃えになるように右インデント調整するやつ.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":877},
{"name":"ユーザー: 03_テキスト関係: 和暦年（西暦）.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":878},
{"name":"ユーザー: 03_テキスト関係: 数字の全角半角変換.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":879},
{"name":"ユーザー: 03_テキスト関係: 正規表現で文字スタイルを割り当てる_v102","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":880},
{"name":"ユーザー: 03_テキスト関係: 正規表現で文字スタイルを割り当てる_v102: 正規表現で文字スタイルを割り当てる_v102.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":881},
{"name":"ユーザー: 03_テキスト関係: 段落群に定位置のタブストップを追加するやつ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":882},
{"name":"ユーザー: 03_テキスト関係: 段落群に定位置のタブストップを追加するやつ: id_addTabStopLump.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":883},
{"name":"ユーザー: 04_オブジェクト","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":884},
{"name":"ユーザー: 04_オブジェクト-間隔調整","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":885},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_0.5mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":886},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_0.7056mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":887},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_0mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":888},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_1.5mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":889},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_1mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":890},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_2.75mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":891},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_!!_2mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":892},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_0.5mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":893},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_0mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":894},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_1.35mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":895},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_1.4112mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":896},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_1.5mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":897},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_1mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":898},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_2.75mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":899},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_2.823mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":900},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_2.824mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":901},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_2mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":902},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_3.824mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":903},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_3mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":904},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_4mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":905},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_5mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":906},
{"name":"ユーザー: 04_オブジェクト-間隔調整: id_distribute_=_7mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":907},
{"name":"ユーザー: 04_オブジェクト: AdjustPageItems_jp_mm.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":908},
{"name":"ユーザー: 04_オブジェクト: アンカー付きオブジェクト","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":909},
{"name":"ユーザー: 04_オブジェクト: アンカー付きオブジェクト: anchoredObjectSettings.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":910},
{"name":"ユーザー: 04_オブジェクト: アンカー付きオブジェクト: anchoredObjectSettingsPanel.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":911},
{"name":"ユーザー: 04_オブジェクト: オブジェクトを戻す.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":912},
{"name":"ユーザー: 04_オブジェクト: ページアイテム位置を調整.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":913},
{"name":"ユーザー: 04_オブジェクト: ページアイテム位置を調整_確実版.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":914},
{"name":"ユーザー: 04_オブジェクト: 選択リンクファイルに赤ラベル.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":915},
{"name":"ユーザー: 05_スタイル関係","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":916},
{"name":"ユーザー: 05_スタイル関係: GrepStyleApplier.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":917},
{"name":"ユーザー: 05_スタイル関係: targetengine renamePstyles.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":918},
{"name":"ユーザー: 05_スタイル関係: フレームグリッドに段落スタイルの属性を反映する.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":919},
{"name":"ユーザー: 05_スタイル関係: 使われている正規表現スタイルをリストアップする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":920},
{"name":"ユーザー: 05_スタイル関係: 日本語文字組版設定-JapaneseParagraphTypesettingManager.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":921},
{"name":"ユーザー: 05_スタイル関係: 正規表現スタイルの適用.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":922},
{"name":"ユーザー: 05_スタイル関係: 段落-文字_スタイル自動生成","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":923},
{"name":"ユーザー: 05_スタイル関係: 段落-文字_スタイル自動生成: スタイル自動生成.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":924},
{"name":"ユーザー: 05_スタイル関係: 段落-文字_スタイル自動生成: スタイル自動生成_改造.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":925},
{"name":"ユーザー: 05_スタイル関係: 段落スタイルに一括で適用-TypesettingStyleManager.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":926},
{"name":"ユーザー: 05_スタイル関係: 段落スタイルの親をみつけるやつ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":927},
{"name":"ユーザー: 05_スタイル関係: 段落スタイルの親をみつけるやつ: id_viewParaStyleBasedOn.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":928},
{"name":"ユーザー: 05_スタイル関係: 段落スタイルを比較する-ParaStyleViewer_v1_2","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":929},
{"name":"ユーザー: 05_スタイル関係: 段落スタイルを比較する-ParaStyleViewer_v1_2: 段落スタイルを比較する-ParaStyleViewer.app","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":930},
{"name":"ユーザー: 05_スタイル関係: 段落スタイル各々の親を晒すやつ-id_viewParaStyleBasedOn","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":931},
{"name":"ユーザー: 05_スタイル関係: 段落スタイル各々の親を晒すやつ-id_viewParaStyleBasedOn: 段落スタイル各々の親を晒すやつ-id_viewParaStyleBasedOn.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":932},
{"name":"ユーザー: 05_スタイル関係: 段落スタイル文字スタイル書き出しCSV.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":933},
{"name":"ユーザー: 06_検索置換","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":934},
{"name":"ユーザー: 06_検索置換: GREP","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":935},
{"name":"ユーザー: 06_検索置換: GREP: ChainGREP_修正版_InDesign2021-2026.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":936},
{"name":"ユーザー: 06_検索置換: GREP: FindChangeScripts","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":937},
{"name":"ユーザー: 06_検索置換: GREP: FindChangeScripts: 和欧間欧文スペース削除.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":938},
{"name":"ユーザー: 06_検索置換: 見開きのUI検索置換.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":939},
{"name":"ユーザー: 99_一時的につかうやつ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":940},
{"name":"ユーザー: ID2Ai_Converter_1.32","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":941},
{"name":"ユーザー: ID2Ai_Converter_1.32: ID2Ai_Converter_1.32.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":942},
{"name":"ユーザー: ID2Ai_Converter_1.32: setting","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":943},
{"name":"ユーザー: ID2Ai_Converter_1.32: setting: IllustratorConvertEngine.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":944},
{"name":"ユーザー: ID2Ai_Converter_1.36","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":945},
{"name":"ユーザー: ID2Ai_Converter_1.36: ID2Ai_Converter_1.36.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":946},
{"name":"ユーザー: ID2Ai_Converter_1.36: setting","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":947},
{"name":"ユーザー: ID2Ai_Converter_1.36: setting: IllustratorConvertEngine.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":948},
{"name":"ユーザー: InDesignドキュメントのカラープロファイルを表示する.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":949},
{"name":"ユーザー: InDesignバッチプリントPDF-v2.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":950},
{"name":"ユーザー: InDesignバッチプリントPDF.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":951},
{"name":"ユーザー: Indd Mini-Edit.app","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":952},
{"name":"ユーザー: QRコードのリンクを開くやつ.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":953},
{"name":"ユーザー: id_orangePagesToOutputRange","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":954},
{"name":"ユーザー: id_orangePagesToOutputRange: オレンジのページを出力範囲に.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":955},
{"name":"ユーザー: id_orangePagesToOutputRange: ページにオレンジラベル.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":956},
{"name":"ユーザー: id_orangePagesToOutputRange: ページラベルを初期化.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":957},
{"name":"ユーザー: id_singlePageExportScripts","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":958},
{"name":"ユーザー: id_singlePageExportScripts: id_activePageRange.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":959},
{"name":"ユーザー: id_singlePageExportScripts: id_exportActivePagePDF.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":960},
{"name":"ユーザー: indd_pdfExport.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":961},
{"name":"ユーザー: ★必須-essential","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":962},
{"name":"ユーザー: ★必須-essential: InDesignの配置に色付け.scpt","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":963},
{"name":"ユーザー: ★必須-essential: ParaStyleViewer","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":964},
{"name":"ユーザー: ★必須-essential: ParaStyleViewer: ParaStyleViewer.app","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":965},
{"name":"ユーザー: ★必須-essential: shag_1.0.3","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":966},
{"name":"ユーザー: ★必須-essential: shag_1.0.3: shag_1.0.3.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":967},
{"name":"ユーザー: ★必須-essential: カッコ類を全角にするやつ.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":968},
{"name":"ユーザー: ★必須-essential: スーパー連番","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":969},
{"name":"ユーザー: ★必須-essential: スーパー連番: LWスーパー連番-改.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":970},
{"name":"ユーザー: ★必須-essential: パッケージ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":971},
{"name":"ユーザー: ★必須-essential: パッケージ: パッケージで孫リンクの画像まで収集する_v110.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":972},
{"name":"ユーザー: ★必須-essential: フレームピッタリフィットさせる","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":973},
{"name":"ユーザー: ★必須-essential: フレームピッタリフィットさせる: superFrameFitPlus.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":974},
{"name":"ユーザー: ★必須-essential: リンク健全性チェッカー.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":975},
{"name":"ユーザー: ★必須-essential: 再変換さん-改.jsx","area":"スクリプト","shortcutText":"デフォルト: Ctrl+R","defined":true,"actionId":4278190139,"actionIdExpression":"0xff000000 + 59","internalName":"スクリプト:ユーザー:★必須-essential:再変換さん-改.jsx","aliases":["スクリプト:ユーザー:★必須-essential:再変換さん-改.jsx"],"executable":false,"source":"GYAHTEI.txt","id":976},
{"name":"ユーザー: ★必須-essential: 数字一律置換","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":977},
{"name":"ユーザー: ★必須-essential: 数字一律置換: Munchkin.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":978},
{"name":"ユーザー: ★必須-essential: 文字数でインデントするやつ","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":979},
{"name":"ユーザー: ★必須-essential: 文字数でインデントするやつ: mojindent.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":980},
{"name":"ユーザー: ★必須-essential: 段落スタイル比較","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":981},
{"name":"ユーザー: ★必須-essential: 段落スタイル比較: ParaStyleViewer","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":982},
{"name":"ユーザー: ★必須-essential: 段落スタイル比較: ParaStyleViewer: ParaStyleViewer.app","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":983},
{"name":"ユーザー: ★必須-essential: 段落背景色や段落囲み罫の表示不良を直す.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":984},
{"name":"ユーザー: ★必須-essential: 縦線の右端でインデントしちゃうやつ-IndentByVerticalLineRight_v091.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":985},
{"name":"ユーザー: おくやみハンドブック","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":986},
{"name":"ユーザー: おくやみハンドブック: CheckAndCenter_NecessaryCells.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":987},
{"name":"ユーザー: おくやみハンドブック: 不要","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":988},
{"name":"ユーザー: おくやみハンドブック: 不要: Center_NecessaryCells_FromMark.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":989},
{"name":"ユーザー: おくやみハンドブック: 不要: Mark_NecessaryCells.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":990},
{"name":"ユーザー: おくやみハンドブック: 文字が「備　考」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":991},
{"name":"ユーザー: おくやみハンドブック: 文字が「問い合わせ先」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":992},
{"name":"ユーザー: おくやみハンドブック: 文字が「手続き・持ち物」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":993},
{"name":"ユーザー: おくやみハンドブック: 文字が「手続可能な人」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":994},
{"name":"ユーザー: おくやみハンドブック: 文字が「持ち物」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":995},
{"name":"ユーザー: おくやみハンドブック: 文字が「期間・注意点等」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":996},
{"name":"ユーザー: おくやみハンドブック: 文字が「必要なもの」のセルだけ中央にする.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":997},
{"name":"ユーザー: せうぞーさんの","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":998},
{"name":"ユーザー: イメージカタログ.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":999},
{"name":"ユーザー: データ結合","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1000},
{"name":"ユーザー: データ結合: ID_DataMergeEXCELLENT1.25.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1001},
{"name":"ユーザー: データ結合: images","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1002},
{"name":"ユーザー: データ結合: setting","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1003},
{"name":"ユーザー: データ結合: tagset.jsx","area":"スクリプト","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1004},
{"name":"はさみツール","area":"ツール","shortcutText":"デフォルト: C","defined":true,"actionId":99594,"actionIdExpression":"0x18500 + 10","internalName":"KBSCE Tools:Scissors Tool","aliases":["はさみツール","KBSCE Tools:Scissors Tool"],"executable":true,"source":"GYAHTEI.txt","id":1005},
{"name":"ものさしツール","area":"ツール","shortcutText":"デフォルト: K","defined":true,"actionId":71681,"actionIdExpression":"0x11800 + 1","internalName":"KBSCE Tools:Measure Tool","aliases":["ものさしツール","KBSCE Tools:Measure Tool"],"executable":true,"source":"GYAHTEI.txt","id":1006},
{"name":"アンカーポイントの切り替えツール","area":"ツール","shortcutText":"デフォルト: Shift+C","defined":true,"actionId":99593,"actionIdExpression":"0x18500 + 9","internalName":"KBSCE Tools:Convert Direction Point Tool","aliases":["アンカーポイントの切り替えツール","KBSCE Tools:Convert Direction Point Tool"],"executable":true,"source":"GYAHTEI.txt","id":1007},
{"name":"アンカーポイントの削除ツール","area":"ツール","shortcutText":"デフォルト: -","defined":true,"actionId":99590,"actionIdExpression":"0x18500 + 6","internalName":"KBSCE Tools:Remove Anchor Point Tool","aliases":["アンカーポイントの削除ツール","KBSCE Tools:Remove Anchor Point Tool"],"executable":true,"source":"GYAHTEI.txt","id":1008},
{"name":"アンカーポイントを追加ツール","area":"ツール","shortcutText":"デフォルト: =","defined":true,"actionId":99589,"actionIdExpression":"0x18500 + 5","internalName":"KBSCE Tools:Add Anchor Point Tool","aliases":["アンカーポイントを追加ツール","KBSCE Tools:Add Anchor Point Tool"],"executable":true,"source":"GYAHTEI.txt","id":1009},
{"name":"カラーを適用","area":"ツール","shortcutText":"デフォルト: ,","defined":true,"actionId":11022,"actionIdExpression":"0x2b00 + 14","internalName":"KBSCE Tools:ApplyColor","aliases":["カラーを適用","KBSCE Tools:ApplyColor"],"executable":true,"source":"GYAHTEI.txt","id":1010},
{"name":"カラーテーマツール","area":"ツール","shortcutText":"デフォルト: Shift+I","defined":true,"actionId":47618,"actionIdExpression":"0xba00 + 2","internalName":"KBSCE Tools:Colortheme Tool","aliases":["カラーテーマツール","KBSCE Tools:Colortheme Tool"],"executable":true,"source":"GYAHTEI.txt","id":1011},
{"name":"グラデーションぼかしツール","area":"ツール","shortcutText":"デフォルト: Shift+G","defined":true,"actionId":40962,"actionIdExpression":"0xa000 + 2","internalName":"KBSCE Tools:kGradientFeatherTool","aliases":["グラデーションぼかしツール","KBSCE Tools:kGradientFeatherTool"],"executable":true,"source":"GYAHTEI.txt","id":1012},
{"name":"グラデーションを適用","area":"ツール","shortcutText":"デフォルト: .","defined":true,"actionId":11023,"actionIdExpression":"0x2b00 + 15","internalName":"KBSCE Tools:ApplyGradient","aliases":["グラデーションを適用","KBSCE Tools:ApplyGradient"],"executable":true,"source":"GYAHTEI.txt","id":1013},
{"name":"グラデーションスウォッチツール","area":"ツール","shortcutText":"デフォルト: G","defined":true,"actionId":40961,"actionIdExpression":"0xa000 + 1","internalName":"KBSCE Tools:Gradient Tool","aliases":["グラデーションスウォッチツール","KBSCE Tools:Gradient Tool"],"executable":true,"source":"GYAHTEI.txt","id":1014},
{"name":"コンテンツ収集ツールとコンテンツ配置ツールを切り替える","area":"ツール","shortcutText":"デフォルト: B","defined":true,"actionId":140289,"actionIdExpression":"0x22400 + 1","internalName":"KBSCE Tools:ToggleContentCollectorTool","aliases":["コンテンツ収集ツールとコンテンツ配置ツールを切り替える","KBSCE Tools:ToggleContentCollectorTool"],"executable":true,"source":"GYAHTEI.txt","id":1015},
{"name":"シアーツール","area":"ツール","shortcutText":"デフォルト: O","defined":true,"actionId":118827,"actionIdExpression":"0x1d000 + 43","internalName":"KBSCE Tools:Shear Tool","aliases":["シアーツール","KBSCE Tools:Shear Tool"],"executable":true,"source":"GYAHTEI.txt","id":1016},
{"name":"スポイトツール","area":"ツール","shortcutText":"デフォルト: I","defined":true,"actionId":47617,"actionIdExpression":"0xba00 + 1","internalName":"KBSCE Tools:Eyedropper Tool","aliases":["スポイトツール","KBSCE Tools:Eyedropper Tool"],"executable":true,"source":"GYAHTEI.txt","id":1017},
{"name":"スムーズツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1018},
{"name":"ズームツール","area":"ツール","shortcutText":"デフォルト: Z","defined":true,"actionId":7681,"actionIdExpression":"0x1e00 + 1","internalName":"KBSCE Tools:Zoom Tool","aliases":["ズームツール","KBSCE Tools:Zoom Tool"],"executable":true,"source":"GYAHTEI.txt","id":1019},
{"name":"ダイレクト選択ツール","area":"ツール","shortcutText":"デフォルト: A","defined":true,"actionId":118823,"actionIdExpression":"0x1d000 + 39","internalName":"KBSCE Tools:Direct Selection Tool","aliases":["ダイレクト選択ツール","KBSCE Tools:Direct Selection Tool"],"executable":true,"source":"GYAHTEI.txt","id":1020},
{"name":"ツールヒント","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1021},
{"name":"テキストとオブジェクトコントロールを切り替える","area":"ツール","shortcutText":"デフォルト: J","defined":true,"actionId":11025,"actionIdExpression":"0x2b00 + 17","internalName":"KBSCE Tools:Toggle Text and Object Control","aliases":["テキストとオブジェクトコントロールを切り替える","KBSCE Tools:Toggle Text and Object Control"],"executable":true,"source":"GYAHTEI.txt","id":1022},
{"name":"デフォルトとプレビュー表示設定間を切り替える","area":"ツール","shortcutText":"デフォルト: W","defined":true,"actionId":118798,"actionIdExpression":"0x1d000 + 14","internalName":"KBSCE Tools:ToggleViewSetting","aliases":["デフォルトとプレビュー表示設定間を切り替える","KBSCE Tools:ToggleViewSetting"],"executable":true,"source":"GYAHTEI.txt","id":1023},
{"name":"ペンツール","area":"ツール","shortcutText":"デフォルト: P","defined":true,"actionId":99588,"actionIdExpression":"0x18500 + 4","internalName":"KBSCE Tools:Pen Tool","aliases":["ペンツール","KBSCE Tools:Pen Tool"],"executable":true,"source":"GYAHTEI.txt","id":1024},
{"name":"ページツール","area":"ツール","shortcutText":"デフォルト: Shift+P","defined":true,"actionId":24350,"actionIdExpression":"0x5f00 + 30","internalName":"KBSCE Tools:Page Tool","aliases":["ページツール","KBSCE Tools:Page Tool"],"executable":true,"source":"GYAHTEI.txt","id":1025},
{"name":"初期値の塗りと線のカラーを適用","area":"ツール","shortcutText":"デフォルト: D","defined":true,"actionId":11021,"actionIdExpression":"0x2b00 + 13","internalName":"KBSCE Tools:Apply Default Fill and Stroke Colors","aliases":["初期値の塗りと線のカラーを適用","KBSCE Tools:Apply Default Fill and Stroke Colors"],"executable":true,"source":"GYAHTEI.txt","id":1026},
{"name":"回転ツール","area":"ツール","shortcutText":"デフォルト: R","defined":true,"actionId":118824,"actionIdExpression":"0x1d000 + 40","internalName":"KBSCE Tools:Rotate Tool","aliases":["回転ツール","KBSCE Tools:Rotate Tool"],"executable":true,"source":"GYAHTEI.txt","id":1027},
{"name":"塗りと線のカラーを入れ替える","area":"ツール","shortcutText":"デフォルト: Shift+X","defined":true,"actionId":11020,"actionIdExpression":"0x2b00 + 12","internalName":"KBSCE Tools:Swap Fill and Stroke Colors","aliases":["塗りと線のカラーを入れ替える","KBSCE Tools:Swap Fill and Stroke Colors"],"executable":true,"source":"GYAHTEI.txt","id":1028},
{"name":"塗りと線を入れ替え","area":"ツール","shortcutText":"デフォルト: X","defined":true,"actionId":11019,"actionIdExpression":"0x2b00 + 11","internalName":"KBSCE Tools:Toggle Fill and Stroke","aliases":["塗りと線を入れ替え","KBSCE Tools:Toggle Fill and Stroke"],"executable":true,"source":"GYAHTEI.txt","id":1029},
{"name":"多角形ツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1030},
{"name":"多角形フレームツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1031},
{"name":"手のひらツール","area":"ツール","shortcutText":"デフォルト: H","defined":true,"actionId":118826,"actionIdExpression":"0x1d000 + 42","internalName":"KBSCE Tools:Grabber Hand Tool","aliases":["手のひらツール","KBSCE Tools:Grabber Hand Tool"],"executable":true,"source":"GYAHTEI.txt","id":1032},
{"name":"拡大 / 縮小ツール","area":"ツール","shortcutText":"デフォルト: S","defined":true,"actionId":118825,"actionIdExpression":"0x1d000 + 41","internalName":"KBSCE Tools:Scale Tool","aliases":["拡大 / 縮小ツール","KBSCE Tools:Scale Tool"],"executable":true,"source":"GYAHTEI.txt","id":1033},
{"name":"楕円形ツール","area":"ツール","shortcutText":"デフォルト: L","defined":true,"actionId":8961,"actionIdExpression":"0x2300 + 1","internalName":"KBSCE Tools:Oval Tool","aliases":["楕円形ツール","KBSCE Tools:Oval Tool"],"executable":true,"source":"GYAHTEI.txt","id":1034},
{"name":"楕円形フレームツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1035},
{"name":"横組みグリッドツール","area":"ツール","shortcutText":"デフォルト: Y","defined":true,"actionId":50180,"actionIdExpression":"0xc400 + 4","internalName":"KBSCE Tools:FrameGrid Horz Tool","aliases":["横組みグリッドツール","KBSCE Tools:FrameGrid Horz Tool"],"executable":true,"source":"GYAHTEI.txt","id":1036},
{"name":"横組みパスツール","area":"ツール","shortcutText":"デフォルト: Shift+T","defined":true,"actionId":119043,"actionIdExpression":"0x1d100 + 3","internalName":"KBSCE Tools:Path Type Horz Tool","aliases":["横組みパスツール","KBSCE Tools:Path Type Horz Tool"],"executable":true,"source":"GYAHTEI.txt","id":1037},
{"name":"横組み文字ツール","area":"ツール","shortcutText":"デフォルト: T","defined":true,"actionId":119682,"actionIdExpression":"0x1d300 + 130","internalName":"KBSCE Tools:Type Tool","aliases":["横組み文字ツール","KBSCE Tools:Type Tool"],"executable":true,"source":"GYAHTEI.txt","id":1038},
{"name":"注釈ツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1039},
{"name":"消しゴムツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1040},
{"name":"線ツール","area":"ツール","shortcutText":"デフォルト: \\, デフォルト: ¥","defined":true,"actionId":2817,"actionIdExpression":"0xb00 + 1","internalName":"KBSCE Tools:Line Tool","aliases":["線ツール","KBSCE Tools:Line Tool"],"executable":true,"source":"GYAHTEI.txt","id":1041},
{"name":"縦組みグリッドツール","area":"ツール","shortcutText":"デフォルト: Q","defined":true,"actionId":50181,"actionIdExpression":"0xc400 + 5","internalName":"KBSCE Tools:FrameGrid Vert Tool","aliases":["縦組みグリッドツール","KBSCE Tools:FrameGrid Vert Tool"],"executable":true,"source":"GYAHTEI.txt","id":1042},
{"name":"縦組みパスツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1043},
{"name":"縦組み文字ツール","area":"ツール","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1044},
{"name":"自由変形ツール","area":"ツール","shortcutText":"デフォルト: E","defined":true,"actionId":45569,"actionIdExpression":"0xb200 + 1","internalName":"KBSCE Tools:Free Transform Tool","aliases":["自由変形ツール","KBSCE Tools:Free Transform Tool"],"executable":true,"source":"GYAHTEI.txt","id":1045},
{"name":"適用なし","area":"ツール","shortcutText":"デフォルト: /, デフォルト: Num /","defined":true,"actionId":11024,"actionIdExpression":"0x2b00 + 16","internalName":"KBSCE Tools:ApplyNone","aliases":["適用なし","KBSCE Tools:ApplyNone"],"executable":true,"source":"GYAHTEI.txt","id":1046},
{"name":"選択ツール","area":"ツール","shortcutText":"デフォルト: V, テキスト: Esc","defined":true,"actionId":118822,"actionIdExpression":"0x1d000 + 38","internalName":"KBSCE Tools:Selection Tool","aliases":["選択ツール","KBSCE Tools:Selection Tool"],"executable":true,"source":"GYAHTEI.txt","id":1047},
{"name":"鉛筆ツール","area":"ツール","shortcutText":"デフォルト: N","defined":true,"actionId":99591,"actionIdExpression":"0x18500 + 7","internalName":"KBSCE Tools:Pencil Tool","aliases":["鉛筆ツール","KBSCE Tools:Pencil Tool"],"executable":true,"source":"GYAHTEI.txt","id":1048},
{"name":"長方形ツール","area":"ツール","shortcutText":"デフォルト: M","defined":true,"actionId":2305,"actionIdExpression":"0x900 + 1","internalName":"KBSCE Tools:Rectangle Tool","aliases":["長方形ツール","KBSCE Tools:Rectangle Tool"],"executable":true,"source":"GYAHTEI.txt","id":1049},
{"name":"長方形フレームツール","area":"ツール","shortcutText":"デフォルト: F","defined":true,"actionId":2306,"actionIdExpression":"0x900 + 2","internalName":"KBSCE Tools:Rectangle Frame Tool","aliases":["長方形フレームツール","KBSCE Tools:Rectangle Frame Tool"],"executable":true,"source":"GYAHTEI.txt","id":1050},
{"name":"間隔ツール","area":"ツール","shortcutText":"デフォルト: U","defined":true,"actionId":134913,"actionIdExpression":"0x20f00 + 1","internalName":"KBSCE Tools:kBasicGapToolStringKey","aliases":["間隔ツール","KBSCE Tools:kBasicGapToolStringKey"],"executable":true,"source":"GYAHTEI.txt","id":1051},
{"name":"(テキスト) 上部のセルを選択","area":"テキストと表","shortcutText":"表: Shift+上向き矢印","defined":true,"actionId":66863,"actionIdExpression":"0x10500 + 47","internalName":"KBSCE Text and Tables:Select Cells Above","aliases":["(テキスト) 上部のセルを選択","KBSCE Text and Tables:Select Cells Above"],"executable":true,"source":"GYAHTEI.txt","id":1052},
{"name":"(テキスト) 下部のセルを選択","area":"テキストと表","shortcutText":"表: Shift+下向き矢印","defined":true,"actionId":66862,"actionIdExpression":"0x10500 + 46","internalName":"KBSCE Text and Tables:Select Cells Below","aliases":["(テキスト) 下部のセルを選択","KBSCE Text and Tables:Select Cells Below"],"executable":true,"source":"GYAHTEI.txt","id":1053},
{"name":"(テキスト) 右のセルを選択","area":"テキストと表","shortcutText":"表: Shift+右向き矢印","defined":true,"actionId":66865,"actionIdExpression":"0x10500 + 49","internalName":"KBSCE Text and Tables:Select Cells to the Right","aliases":["(テキスト) 右のセルを選択","KBSCE Text and Tables:Select Cells to the Right"],"executable":true,"source":"GYAHTEI.txt","id":1054},
{"name":"(テキスト) 左のセルを選択","area":"テキストと表","shortcutText":"表: Shift+左向き矢印","defined":true,"actionId":66864,"actionIdExpression":"0x10500 + 48","internalName":"KBSCE Text and Tables:Select Cells to the Left","aliases":["(テキスト) 左のセルを選択","KBSCE Text and Tables:Select Cells to the Left"],"executable":true,"source":"GYAHTEI.txt","id":1055},
{"name":"0°","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1056},
{"name":"1 単語右へ移動","area":"テキストと表","shortcutText":"テキスト: Cmd+右向き矢印","defined":true,"actionId":119560,"actionIdExpression":"0x1d300 + 8","internalName":"KBSCE Text and Tables:Move to the right one word","aliases":["1 単語右へ移動","KBSCE Text and Tables:Move to the right one word"],"executable":true,"source":"GYAHTEI.txt","id":1057},
{"name":"1 単語左へ移動","area":"テキストと表","shortcutText":"テキスト: Cmd+左向き矢印","defined":true,"actionId":119561,"actionIdExpression":"0x1d300 + 9","internalName":"KBSCE Text and Tables:Move to the left one word","aliases":["1 単語左へ移動","KBSCE Text and Tables:Move to the left one word"],"executable":true,"source":"GYAHTEI.txt","id":1058},
{"name":"1 文字右へ移動","area":"テキストと表","shortcutText":"テキスト: 右向き矢印","defined":true,"actionId":119556,"actionIdExpression":"0x1d300 + 4","internalName":"KBSCE Text and Tables:Move to the right one character","aliases":["1 文字右へ移動","KBSCE Text and Tables:Move to the right one character"],"executable":true,"source":"GYAHTEI.txt","id":1059},
{"name":"1 文字左へ移動","area":"テキストと表","shortcutText":"テキスト: 左向き矢印","defined":true,"actionId":119557,"actionIdExpression":"0x1d300 + 5","internalName":"KBSCE Text and Tables:Move to the left one character","aliases":["1 文字左へ移動","KBSCE Text and Tables:Move to the left one character"],"executable":true,"source":"GYAHTEI.txt","id":1060},
{"name":"1 行上へ移動","area":"テキストと表","shortcutText":"テキスト: 上向き矢印","defined":true,"actionId":119558,"actionIdExpression":"0x1d300 + 6","internalName":"KBSCE Text and Tables:Move up one line","aliases":["1 行上へ移動","KBSCE Text and Tables:Move up one line"],"executable":true,"source":"GYAHTEI.txt","id":1061},
{"name":"1 行下へ移動","area":"テキストと表","shortcutText":"テキスト: 下向き矢印","defined":true,"actionId":119559,"actionIdExpression":"0x1d300 + 7","internalName":"KBSCE Text and Tables:Move down one line ","aliases":["1 行下へ移動","KBSCE Text and Tables:Move down one line "],"executable":true,"source":"GYAHTEI.txt","id":1062},
{"name":"180°","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1063},
{"name":"270°","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1064},
{"name":"90°","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1065},
{"name":"すべてのオーバーライドを消去","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1066},
{"name":"すべてのストーリの構成を直ちにやり直す","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1067},
{"name":"すべての脚注を展開","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1068},
{"name":"その他...","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1069},
{"name":"アンカー付きオブジェクトを挿入 / アンカーマーカーへ移動","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1070},
{"name":"オブジェクトを上へ","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: 上向き矢印","defined":true,"actionId":66922,"actionIdExpression":"0x10500 + 106","internalName":"KBSCE Text and Tables:Object Up","aliases":["オブジェクトを上へ","KBSCE Text and Tables:Object Up"],"executable":true,"source":"GYAHTEI.txt","id":1071},
{"name":"オブジェクトを下へ","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: 下向き矢印","defined":true,"actionId":66923,"actionIdExpression":"0x10500 + 107","internalName":"KBSCE Text and Tables:Object Down","aliases":["オブジェクトを下へ","KBSCE Text and Tables:Object Down"],"executable":true,"source":"GYAHTEI.txt","id":1072},
{"name":"オブジェクトを前のセルへ移動","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: Shift+Tab","defined":true,"actionId":66926,"actionIdExpression":"0x10500 + 110","internalName":"KBSCE Text and Tables:Object Move to Prev Cell","aliases":["オブジェクトを前のセルへ移動","KBSCE Text and Tables:Object Move to Prev Cell"],"executable":true,"source":"GYAHTEI.txt","id":1073},
{"name":"オブジェクトを右へ","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: 右向き矢印","defined":true,"actionId":66920,"actionIdExpression":"0x10500 + 104","internalName":"KBSCE Text and Tables:Object Right","aliases":["オブジェクトを右へ","KBSCE Text and Tables:Object Right"],"executable":true,"source":"GYAHTEI.txt","id":1074},
{"name":"オブジェクトを左へ","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: 左向き矢印","defined":true,"actionId":66921,"actionIdExpression":"0x10500 + 105","internalName":"KBSCE Text and Tables:Object Left","aliases":["オブジェクトを左へ","KBSCE Text and Tables:Object Left"],"executable":true,"source":"GYAHTEI.txt","id":1075},
{"name":"オブジェクトを次のセルへ移動","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: Tab","defined":true,"actionId":66925,"actionIdExpression":"0x10500 + 109","internalName":"KBSCE Text and Tables:Object Move to Next Cell","aliases":["オブジェクトを次のセルへ移動","KBSCE Text and Tables:Object Move to Next Cell"],"executable":true,"source":"GYAHTEI.txt","id":1076},
{"name":"オブジェクトを終了","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: Esc","defined":true,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1077},
{"name":"カーニング / トラッキング x 5 増加","area":"テキストと表","shortcutText":"テキスト: Opt+Cmd+右向き矢印","defined":true,"actionId":119639,"actionIdExpression":"0x1d300 + 87","internalName":"KBSCE Text and Tables:Increase kerning/tracking x 5","aliases":["カーニング / トラッキング x 5 増加","KBSCE Text and Tables:Increase kerning/tracking x 5"],"executable":true,"source":"GYAHTEI.txt","id":1078},
{"name":"カーニング / トラッキング x 5 減少","area":"テキストと表","shortcutText":"テキスト: Opt+Cmd+左向き矢印","defined":true,"actionId":119640,"actionIdExpression":"0x1d300 + 88","internalName":"KBSCE Text and Tables:Decrease kerning/tracking x 5","aliases":["カーニング / トラッキング x 5 減少","KBSCE Text and Tables:Decrease kerning/tracking x 5"],"executable":true,"source":"GYAHTEI.txt","id":1079},
{"name":"カーニング / トラッキングを増加","area":"テキストと表","shortcutText":"テキスト: Opt+Shift+右向き矢印, テキスト: Opt+右向き矢印","defined":true,"actionId":119637,"actionIdExpression":"0x1d300 + 85","internalName":"KBSCE Text and Tables:Increase kerning/tracking","aliases":["カーニング / トラッキングを増加","KBSCE Text and Tables:Increase kerning/tracking"],"executable":true,"source":"GYAHTEI.txt","id":1080},
{"name":"カーニング / トラッキングを減少","area":"テキストと表","shortcutText":"テキスト: Opt+Shift+左向き矢印, テキスト: Opt+左向き矢印","defined":true,"actionId":119638,"actionIdExpression":"0x1d300 + 86","internalName":"KBSCE Text and Tables:Decrease kerning/tracking","aliases":["カーニング / トラッキングを減少","KBSCE Text and Tables:Decrease kerning/tracking"],"executable":true,"source":"GYAHTEI.txt","id":1081},
{"name":"カーニングとトラッキングのリセット","area":"テキストと表","shortcutText":"テキスト: Opt+Cmd+Q","defined":true,"actionId":26895,"actionIdExpression":"0x6900 + 15","internalName":"KBSCE Text and Tables:Reset Kerning and Tracking","aliases":["カーニングとトラッキングのリセット","KBSCE Text and Tables:Reset Kerning and Tracking"],"executable":true,"source":"GYAHTEI.txt","id":1082},
{"name":"コンポーザーを切り替え","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1083},
{"name":"ストーリーの先頭へ移動","area":"テキストと表","shortcutText":"テキスト: Cmd+Home","defined":true,"actionId":119567,"actionIdExpression":"0x1d300 + 15","internalName":"KBSCE Text and Tables:Move to begining of story","aliases":["ストーリーの先頭へ移動","KBSCE Text and Tables:Move to begining of story"],"executable":true,"source":"GYAHTEI.txt","id":1084},
{"name":"ストーリーの先頭まで選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+Home","defined":true,"actionId":119580,"actionIdExpression":"0x1d300 + 28","internalName":"KBSCE Text and Tables:Select to beginning of story","aliases":["ストーリーの先頭まで選択","KBSCE Text and Tables:Select to beginning of story"],"executable":true,"source":"GYAHTEI.txt","id":1085},
{"name":"ストーリーの最後へ移動","area":"テキストと表","shortcutText":"テキスト: Cmd+End","defined":true,"actionId":119566,"actionIdExpression":"0x1d300 + 14","internalName":"KBSCE Text and Tables:Move to end of story","aliases":["ストーリーの最後へ移動","KBSCE Text and Tables:Move to end of story"],"executable":true,"source":"GYAHTEI.txt","id":1086},
{"name":"ストーリーの終わりまで選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+End","defined":true,"actionId":119579,"actionIdExpression":"0x1d300 + 27","internalName":"KBSCE Text and Tables:Select to end of story","aliases":["ストーリーの終わりまで選択","KBSCE Text and Tables:Select to end of story"],"executable":true,"source":"GYAHTEI.txt","id":1087},
{"name":"スポットライト内を検索","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1088},
{"name":"セル / テキストの選択へトグル","area":"テキストと表","shortcutText":"表: Esc","defined":true,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1089},
{"name":"セルの幅を広くする","area":"テキストと表","shortcutText":"表: Cmd+右向き矢印","defined":true,"actionId":66928,"actionIdExpression":"0x10500 + 112","internalName":"KBSCE Text and Tables:Increase Cell Width","aliases":["セルの幅を広くする","KBSCE Text and Tables:Increase Cell Width"],"executable":true,"source":"GYAHTEI.txt","id":1090},
{"name":"セルの幅を狭くする","area":"テキストと表","shortcutText":"表: Cmd+左向き矢印","defined":true,"actionId":66929,"actionIdExpression":"0x10500 + 113","internalName":"KBSCE Text and Tables:Decrease Cell Width","aliases":["セルの幅を狭くする","KBSCE Text and Tables:Decrease Cell Width"],"executable":true,"source":"GYAHTEI.txt","id":1091},
{"name":"セルの自動拡大と手動拡大の切り替え","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1092},
{"name":"セルの高さを上げる","area":"テキストと表","shortcutText":"表: Cmd+下向き矢印","defined":true,"actionId":66930,"actionIdExpression":"0x10500 + 114","internalName":"KBSCE Text and Tables:Increase Cell Height","aliases":["セルの高さを上げる","KBSCE Text and Tables:Increase Cell Height"],"executable":true,"source":"GYAHTEI.txt","id":1093},
{"name":"セルの高さを下げる","area":"テキストと表","shortcutText":"表: Cmd+上向き矢印","defined":true,"actionId":66931,"actionIdExpression":"0x10500 + 115","internalName":"KBSCE Text and Tables:Decrease Cell Height","aliases":["セルの高さを下げる","KBSCE Text and Tables:Decrease Cell Height"],"executable":true,"source":"GYAHTEI.txt","id":1094},
{"name":"テキストのドラッグ＆ドロップ環境設定の切り替え","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1095},
{"name":"テキストを置換","area":"テキストと表","shortcutText":"テキスト: Cmd+F3","defined":true,"actionId":18692,"actionIdExpression":"0x4900 + 4","internalName":"KBSCE Text and Tables:Replace with Change To text","aliases":["テキストを置換","KBSCE Text and Tables:Replace with Change To text"],"executable":true,"source":"GYAHTEI.txt","id":1096},
{"name":"テキストを置換して次を検索","area":"テキストと表","shortcutText":"テキスト: Shift+F3","defined":true,"actionId":18691,"actionIdExpression":"0x4900 + 3","internalName":"KBSCE Text and Tables:Replace with Change To text and Find Next","aliases":["テキストを置換して次を検索","KBSCE Text and Tables:Replace with Change To text and Find Next"],"executable":true,"source":"GYAHTEI.txt","id":1097},
{"name":"ノド揃え","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1098},
{"name":"フォントサイズ x 5 増加","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+.","defined":true,"actionId":119645,"actionIdExpression":"0x1d300 + 93","internalName":"KBSCE Text and Tables:Increase point size x 5","aliases":["フォントサイズ x 5 増加","KBSCE Text and Tables:Increase point size x 5"],"executable":true,"source":"GYAHTEI.txt","id":1099},
{"name":"フォントサイズ x 5 減少","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+,","defined":true,"actionId":119646,"actionIdExpression":"0x1d300 + 94","internalName":"KBSCE Text and Tables:Decrease point size x 5","aliases":["フォントサイズ x 5 減少","KBSCE Text and Tables:Decrease point size x 5"],"executable":true,"source":"GYAHTEI.txt","id":1100},
{"name":"フォントサイズを増加","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+.","defined":true,"actionId":119633,"actionIdExpression":"0x1d300 + 81","internalName":"KBSCE Text and Tables:Increase point size","aliases":["フォントサイズを増加","KBSCE Text and Tables:Increase point size"],"executable":true,"source":"GYAHTEI.txt","id":1101},
{"name":"フォントサイズを減少","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+,","defined":true,"actionId":119634,"actionIdExpression":"0x1d300 + 82","internalName":"KBSCE Text and Tables:Decrease point size","aliases":["フォントサイズを減少","KBSCE Text and Tables:Decrease point size"],"executable":true,"source":"GYAHTEI.txt","id":1102},
{"name":"フレーム内の 1 行目に移動","area":"テキストと表","shortcutText":"表: Page Up","defined":true,"actionId":66851,"actionIdExpression":"0x10500 + 35","internalName":"KBSCE Text and Tables:Move to First Row in Frame","aliases":["フレーム内の 1 行目に移動","KBSCE Text and Tables:Move to First Row in Frame"],"executable":true,"source":"GYAHTEI.txt","id":1103},
{"name":"フレーム内の最終行へ移動","area":"テキストと表","shortcutText":"表: Page Down","defined":true,"actionId":66852,"actionIdExpression":"0x10500 + 36","internalName":"KBSCE Text and Tables:Move to Last Row in Frame","aliases":["フレーム内の最終行へ移動","KBSCE Text and Tables:Move to Last Row in Frame"],"executable":true,"source":"GYAHTEI.txt","id":1104},
{"name":"ベースライングリッドに揃える","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+G","defined":true,"actionId":119627,"actionIdExpression":"0x1d300 + 75","internalName":"KBSCE Text and Tables:Align to baseline grid","aliases":["ベースライングリッドに揃える","KBSCE Text and Tables:Align to baseline grid"],"executable":true,"source":"GYAHTEI.txt","id":1105},
{"name":"ベースラインシフト x 5 増加","area":"テキストと表","shortcutText":"テキスト: Opt+Shift+Cmd+上向き矢印","defined":true,"actionId":119643,"actionIdExpression":"0x1d300 + 91","internalName":"KBSCE Text and Tables:Increase baseline shift x 5","aliases":["ベースラインシフト x 5 増加","KBSCE Text and Tables:Increase baseline shift x 5"],"executable":true,"source":"GYAHTEI.txt","id":1106},
{"name":"ベースラインシフト x 5 減少","area":"テキストと表","shortcutText":"テキスト: Opt+Shift+Cmd+下向き矢印","defined":true,"actionId":119644,"actionIdExpression":"0x1d300 + 92","internalName":"KBSCE Text and Tables:Decrease baseline shift x 5","aliases":["ベースラインシフト x 5 減少","KBSCE Text and Tables:Decrease baseline shift x 5"],"executable":true,"source":"GYAHTEI.txt","id":1107},
{"name":"ベースラインシフトを増加","area":"テキストと表","shortcutText":"テキスト: Opt+Shift+上向き矢印","defined":true,"actionId":119641,"actionIdExpression":"0x1d300 + 89","internalName":"KBSCE Text and Tables:Increase baseline shift","aliases":["ベースラインシフトを増加","KBSCE Text and Tables:Increase baseline shift"],"executable":true,"source":"GYAHTEI.txt","id":1108},
{"name":"ベースラインシフトを減少","area":"テキストと表","shortcutText":"テキスト: Opt+Shift+下向き矢印","defined":true,"actionId":119642,"actionIdExpression":"0x1d300 + 90","internalName":"KBSCE Text and Tables:Decrease baseline shift","aliases":["ベースラインシフトを減少","KBSCE Text and Tables:Decrease baseline shift"],"executable":true,"source":"GYAHTEI.txt","id":1109},
{"name":"上へ 1 行選択","area":"テキストと表","shortcutText":"テキスト: Shift+上向き矢印","defined":true,"actionId":119574,"actionIdExpression":"0x1d300 + 22","internalName":"KBSCE Text and Tables:Select one line above","aliases":["上へ 1 行選択","KBSCE Text and Tables:Select one line above"],"executable":true,"source":"GYAHTEI.txt","id":1110},
{"name":"上へ移動","area":"テキストと表","shortcutText":"表: 上向き矢印","defined":true,"actionId":66859,"actionIdExpression":"0x10500 + 43","internalName":"KBSCE Text and Tables:Move Up","aliases":["上へ移動","KBSCE Text and Tables:Move Up"],"executable":true,"source":"GYAHTEI.txt","id":1111},
{"name":"下へ 1 行選択","area":"テキストと表","shortcutText":"テキスト: Shift+下向き矢印","defined":true,"actionId":119575,"actionIdExpression":"0x1d300 + 23","internalName":"KBSCE Text and Tables:Select one line below","aliases":["下へ 1 行選択","KBSCE Text and Tables:Select one line below"],"executable":true,"source":"GYAHTEI.txt","id":1112},
{"name":"下へ移動","area":"テキストと表","shortcutText":"表: 下向き矢印","defined":true,"actionId":66858,"actionIdExpression":"0x10500 + 42","internalName":"KBSCE Text and Tables:Move Down","aliases":["下へ移動","KBSCE Text and Tables:Move Down"],"executable":true,"source":"GYAHTEI.txt","id":1113},
{"name":"中央揃え","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+C","defined":true,"actionId":119623,"actionIdExpression":"0x1d300 + 71","internalName":"KBSCE Text and Tables:Align center","aliases":["中央揃え","KBSCE Text and Tables:Align center"],"executable":true,"source":"GYAHTEI.txt","id":1114},
{"name":"仮想ボディの上 / 右","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1115},
{"name":"仮想ボディの下 / 左","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1116},
{"name":"仮想ボディの中央","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1117},
{"name":"全ストーリーを再計算","area":"テキストと表","shortcutText":"デフォルト: Opt+Cmd+/","defined":true,"actionId":119685,"actionIdExpression":"0x1d300 + 133","internalName":"KBSCE Text and Tables:Recompose all stories","aliases":["全ストーリーを再計算","KBSCE Text and Tables:Recompose all stories"],"executable":true,"source":"GYAHTEI.txt","id":1118},
{"name":"分離禁止処理","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1119},
{"name":"列ごとに配置","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1120},
{"name":"列を挿入","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1121},
{"name":"列内の先頭セルへ移動","area":"テキストと表","shortcutText":"表: Opt+Page Up","defined":true,"actionId":66847,"actionIdExpression":"0x10500 + 31","internalName":"KBSCE Text and Tables:Move to First Cell in Column","aliases":["列内の先頭セルへ移動","KBSCE Text and Tables:Move to First Cell in Column"],"executable":true,"source":"GYAHTEI.txt","id":1122},
{"name":"列内の最終セルへ移動","area":"テキストと表","shortcutText":"表: Opt+Page Down","defined":true,"actionId":66848,"actionIdExpression":"0x10500 + 32","internalName":"KBSCE Text and Tables:Move to Last Cell in Column","aliases":["列内の最終セルへ移動","KBSCE Text and Tables:Move to Last Cell in Column"],"executable":true,"source":"GYAHTEI.txt","id":1123},
{"name":"削除","area":"テキストと表","shortcutText":"表: Del","defined":true,"actionId":66888,"actionIdExpression":"0x10500 + 72","internalName":"KBSCE Text and Tables:kTablesDelete","aliases":["削除","KBSCE Text and Tables:kTablesDelete"],"executable":true,"source":"GYAHTEI.txt","id":1124},
{"name":"前の 1 段落を選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+上向き矢印","defined":true,"actionId":119576,"actionIdExpression":"0x1d300 + 24","internalName":"KBSCE Text and Tables:Select one paragraph before","aliases":["前の 1 段落を選択","KBSCE Text and Tables:Select one paragraph before"],"executable":true,"source":"GYAHTEI.txt","id":1125},
{"name":"前のセルへ移動","area":"テキストと表","shortcutText":"表: Shift+Tab","defined":true,"actionId":66857,"actionIdExpression":"0x10500 + 41","internalName":"KBSCE Text and Tables:Move to Previous Cell","aliases":["前のセルへ移動","KBSCE Text and Tables:Move to Previous Cell"],"executable":true,"source":"GYAHTEI.txt","id":1126},
{"name":"前の段落へ移動","area":"テキストと表","shortcutText":"テキスト: Cmd+上向き矢印","defined":true,"actionId":119564,"actionIdExpression":"0x1d300 + 12","internalName":"KBSCE Text and Tables:Move to the previous para","aliases":["前の段落へ移動","KBSCE Text and Tables:Move to the previous para"],"executable":true,"source":"GYAHTEI.txt","id":1127},
{"name":"単語間隔 x 5 増加","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+\\","defined":true,"actionId":119665,"actionIdExpression":"0x1d300 + 113","internalName":"KBSCE Text and Tables:Increase word space x 5","aliases":["単語間隔 x 5 増加","KBSCE Text and Tables:Increase word space x 5"],"executable":true,"source":"GYAHTEI.txt","id":1128},
{"name":"単語間隔 x 5 減少","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+Delete","defined":true,"actionId":119667,"actionIdExpression":"0x1d300 + 115","internalName":"KBSCE Text and Tables:Decrease word space x 5","aliases":["単語間隔 x 5 減少","KBSCE Text and Tables:Decrease word space x 5"],"executable":true,"source":"GYAHTEI.txt","id":1129},
{"name":"単語間隔の増加","area":"テキストと表","shortcutText":"デフォルト: Opt+Cmd+\\, デフォルト: Ctrl+Opt+Cmd+\\","defined":true,"actionId":119664,"actionIdExpression":"0x1d300 + 112","internalName":"KBSCE Text and Tables:Increase word space","aliases":["単語間隔の増加","KBSCE Text and Tables:Increase word space"],"executable":true,"source":"GYAHTEI.txt","id":1130},
{"name":"単語間隔の減少","area":"テキストと表","shortcutText":"デフォルト: Opt+Cmd+Delete","defined":true,"actionId":119666,"actionIdExpression":"0x1d300 + 114","internalName":"KBSCE Text and Tables:Decrease word space","aliases":["単語間隔の減少","KBSCE Text and Tables:Decrease word space"],"executable":true,"source":"GYAHTEI.txt","id":1131},
{"name":"右 / 下揃え","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+R","defined":true,"actionId":119624,"actionIdExpression":"0x1d300 + 72","internalName":"KBSCE Text and Tables:Align right","aliases":["右 / 下揃え","KBSCE Text and Tables:Align right"],"executable":true,"source":"GYAHTEI.txt","id":1132},
{"name":"右の 1 文字を削除","area":"テキストと表","shortcutText":"テキスト: Del, テキスト: Shift+Del","defined":true,"actionId":119581,"actionIdExpression":"0x1d300 + 29","internalName":"KBSCE Text and Tables:Delete one character to the right","aliases":["右の 1 文字を削除","KBSCE Text and Tables:Delete one character to the right"],"executable":true,"source":"GYAHTEI.txt","id":1133},
{"name":"右へ 1 単語選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+右向き矢印","defined":true,"actionId":119570,"actionIdExpression":"0x1d300 + 18","internalName":"KBSCE Text and Tables:Select one word to the right","aliases":["右へ 1 単語選択","KBSCE Text and Tables:Select one word to the right"],"executable":true,"source":"GYAHTEI.txt","id":1134},
{"name":"右へ 1 文字選択","area":"テキストと表","shortcutText":"テキスト: Shift+右向き矢印","defined":true,"actionId":119568,"actionIdExpression":"0x1d300 + 16","internalName":"KBSCE Text and Tables:Select one character to the right","aliases":["右へ 1 文字選択","KBSCE Text and Tables:Select one character to the right"],"executable":true,"source":"GYAHTEI.txt","id":1135},
{"name":"右へ移動","area":"テキストと表","shortcutText":"表: 右向き矢印","defined":true,"actionId":66861,"actionIdExpression":"0x10500 + 45","internalName":"KBSCE Text and Tables:Move Right","aliases":["右へ移動","KBSCE Text and Tables:Move Right"],"executable":true,"source":"GYAHTEI.txt","id":1136},
{"name":"均等配置","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+J","defined":true,"actionId":119625,"actionIdExpression":"0x1d300 + 73","internalName":"KBSCE Text and Tables:Align justify","aliases":["均等配置","KBSCE Text and Tables:Align justify"],"executable":true,"source":"GYAHTEI.txt","id":1137},
{"name":"垂直比率を x 5 増加","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1138},
{"name":"垂直比率を x 5 減少","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1139},
{"name":"垂直比率を増加","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1140},
{"name":"垂直比率を減少","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1141},
{"name":"太字を適用","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+B","defined":true,"actionId":119610,"actionIdExpression":"0x1d300 + 58","internalName":"KBSCE Text and Tables:Apply bold","aliases":["太字を適用","KBSCE Text and Tables:Apply bold"],"executable":true,"source":"GYAHTEI.txt","id":1142},
{"name":"小口揃え","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1143},
{"name":"左 / 上揃え","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+L","defined":true,"actionId":119622,"actionIdExpression":"0x1d300 + 70","internalName":"KBSCE Text and Tables:Align left","aliases":["左 / 上揃え","KBSCE Text and Tables:Align left"],"executable":true,"source":"GYAHTEI.txt","id":1144},
{"name":"左の 1 文字を削除","area":"テキストと表","shortcutText":"テキスト: Delete, テキスト: Shift+Delete","defined":true,"actionId":119582,"actionIdExpression":"0x1d300 + 30","internalName":"KBSCE Text and Tables:Delete one character to the left","aliases":["左の 1 文字を削除","KBSCE Text and Tables:Delete one character to the left"],"executable":true,"source":"GYAHTEI.txt","id":1145},
{"name":"左へ 1 単語選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+左向き矢印","defined":true,"actionId":119571,"actionIdExpression":"0x1d300 + 19","internalName":"KBSCE Text and Tables:Select one word to the left","aliases":["左へ 1 単語選択","KBSCE Text and Tables:Select one word to the left"],"executable":true,"source":"GYAHTEI.txt","id":1146},
{"name":"左へ 1 文字選択","area":"テキストと表","shortcutText":"テキスト: Shift+左向き矢印","defined":true,"actionId":119569,"actionIdExpression":"0x1d300 + 17","internalName":"KBSCE Text and Tables:Select one character to the left","aliases":["左へ 1 文字選択","KBSCE Text and Tables:Select one character to the left"],"executable":true,"source":"GYAHTEI.txt","id":1147},
{"name":"左へ移動","area":"テキストと表","shortcutText":"表: 左向き矢印","defined":true,"actionId":66860,"actionIdExpression":"0x10500 + 44","internalName":"KBSCE Text and Tables:Move Left","aliases":["左へ移動","KBSCE Text and Tables:Move Left"],"executable":true,"source":"GYAHTEI.txt","id":1148},
{"name":"後ろの 1 段落を選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+下向き矢印","defined":true,"actionId":119577,"actionIdExpression":"0x1d300 + 25","internalName":"KBSCE Text and Tables:Select one paragraph forward","aliases":["後ろの 1 段落を選択","KBSCE Text and Tables:Select one paragraph forward"],"executable":true,"source":"GYAHTEI.txt","id":1149},
{"name":"改フレームして行開始","area":"テキストと表","shortcutText":"表: Shift+Enter","defined":true,"actionId":66874,"actionIdExpression":"0x10500 + 58","internalName":"KBSCE Text and Tables:Start Row on Next Frame","aliases":["改フレームして行開始","KBSCE Text and Tables:Start Row on Next Frame"],"executable":true,"source":"GYAHTEI.txt","id":1150},
{"name":"改段して行開始","area":"テキストと表","shortcutText":"表: Enter","defined":true,"actionId":66873,"actionIdExpression":"0x10500 + 57","internalName":"KBSCE Text and Tables:Start Row on Next Column","aliases":["改段して行開始","KBSCE Text and Tables:Start Row on Next Column"],"executable":true,"source":"GYAHTEI.txt","id":1151},
{"name":"文字のオーバーライドを消去","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1152},
{"name":"斜体を適用","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+I","defined":true,"actionId":119611,"actionIdExpression":"0x1d300 + 59","internalName":"KBSCE Text and Tables:Apply italic","aliases":["斜体を適用","KBSCE Text and Tables:Apply italic"],"executable":true,"source":"GYAHTEI.txt","id":1153},
{"name":"検索文字列に読み込み後に次を検索","area":"テキストと表","shortcutText":"テキスト: Shift+F1","defined":true,"actionId":18690,"actionIdExpression":"0x4900 + 2","internalName":"KBSCE Text and Tables:Load Find and Find Next instance","aliases":["検索文字列に読み込み後に次を検索","KBSCE Text and Tables:Load Find and Find Next instance"],"executable":true,"source":"GYAHTEI.txt","id":1154},
{"name":"標準を適用","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+Y","defined":true,"actionId":119609,"actionIdExpression":"0x1d300 + 57","internalName":"KBSCE Text and Tables:Apply normal","aliases":["標準を適用","KBSCE Text and Tables:Apply normal"],"executable":true,"source":"GYAHTEI.txt","id":1155},
{"name":"標準横方向テキストスケール","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1156},
{"name":"標準縦方向テキストスケール","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1157},
{"name":"次のセルへ移動","area":"テキストと表","shortcutText":"表: Tab","defined":true,"actionId":66856,"actionIdExpression":"0x10500 + 40","internalName":"KBSCE Text and Tables:Move to Next Cell","aliases":["次のセルへ移動","KBSCE Text and Tables:Move to Next Cell"],"executable":true,"source":"GYAHTEI.txt","id":1158},
{"name":"次の段落へ移動","area":"テキストと表","shortcutText":"テキスト: Cmd+下向き矢印","defined":true,"actionId":119565,"actionIdExpression":"0x1d300 + 13","internalName":"KBSCE Text and Tables:Move to the next para ","aliases":["次の段落へ移動","KBSCE Text and Tables:Move to the next para "],"executable":true,"source":"GYAHTEI.txt","id":1159},
{"name":"次の行と連動","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1160},
{"name":"次を検索","area":"テキストと表","shortcutText":"テキスト: Shift+F2","defined":true,"actionId":18706,"actionIdExpression":"0x4900 + 18","internalName":"KBSCE Text and Tables:Find Next","aliases":["次を検索","KBSCE Text and Tables:Find Next"],"executable":true,"source":"GYAHTEI.txt","id":1161},
{"name":"欧文ベースライン","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1162},
{"name":"欧文単語をカット＆ペーストするときに自動的に間隔の調整を切り替え","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1163},
{"name":"正規表現 テキストを置換","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1164},
{"name":"正規表現 テキストを置換して次を検索","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1165},
{"name":"正規表現 検索文字列に読み込み後に次を検索","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1166},
{"name":"正規表現 次を検索","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1167},
{"name":"正規表現 選択したテキストを検索文字列に読み込み","area":"テキストと表","shortcutText":"デフォルト: Cmd+F1","defined":true,"actionId":127959,"actionIdExpression":"0x1f300 + 215","internalName":"KBSCE Text and Tables:GREP Load Find with selected text","aliases":["正規表現 選択したテキストを検索文字列に読み込み","KBSCE Text and Tables:GREP Load Find with selected text"],"executable":true,"source":"GYAHTEI.txt","id":1168},
{"name":"正規表現 選択したテキストを置換文字列に読み込み","area":"テキストと表","shortcutText":"デフォルト: Cmd+F2","defined":true,"actionId":127964,"actionIdExpression":"0x1f300 + 220","internalName":"KBSCE Text and Tables:GREP Load Replace with selected text","aliases":["正規表現 選択したテキストを置換文字列に読み込み","KBSCE Text and Tables:GREP Load Replace with selected text"],"executable":true,"source":"GYAHTEI.txt","id":1169},
{"name":"段落のオーバーライド消去","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1170},
{"name":"水平比率 x 5 増加","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1171},
{"name":"水平比率 x 5 減少","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1172},
{"name":"水平比率を増加","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1173},
{"name":"水平比率を減少","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1174},
{"name":"消去","area":"テキストと表","shortcutText":"表: Delete","defined":true,"actionId":66887,"actionIdExpression":"0x10500 + 71","internalName":"KBSCE Text and Tables:kTablesClear","aliases":["消去","KBSCE Text and Tables:kTablesClear"],"executable":true,"source":"GYAHTEI.txt","id":1175},
{"name":"環境にないフォントリストの更新","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+/","defined":true,"actionId":119653,"actionIdExpression":"0x1d300 + 101","internalName":"KBSCE Text and Tables:Update missing font list","aliases":["環境にないフォントリストの更新","KBSCE Text and Tables:Update missing font list"],"executable":true,"source":"GYAHTEI.txt","id":1176},
{"name":"縦組み中の欧文回転","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1177},
{"name":"自動ハイフネーションオン / オフ","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1178},
{"name":"自動縦中横設定...","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+H","defined":true,"actionId":27191,"actionIdExpression":"0x6a00 + 55","internalName":"KBSCE Text and Tables:Auto Tatechuyoko...","aliases":["自動縦中横設定...","KBSCE Text and Tables:Auto Tatechuyoko..."],"executable":true,"source":"GYAHTEI.txt","id":1179},
{"name":"自動行送り","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1180},
{"name":"英文引用符の環境設定を切り替え","area":"テキストと表","shortcutText":"デフォルト: Opt+Shift+Cmd+'","defined":true,"actionId":12547,"actionIdExpression":"0x3100 + 3","internalName":"KBSCE Text and Tables:Use Typographer's Quotes","aliases":["英文引用符の環境設定を切り替え","KBSCE Text and Tables:Use Typographer's Quotes"],"executable":true,"source":"GYAHTEI.txt","id":1181},
{"name":"行ごとに配置","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1182},
{"name":"行の先頭まで選択","area":"テキストと表","shortcutText":"テキスト: Shift+Home","defined":true,"actionId":119572,"actionIdExpression":"0x1d300 + 20","internalName":"KBSCE Text and Tables:Select to the start of the line","aliases":["行の先頭まで選択","KBSCE Text and Tables:Select to the start of the line"],"executable":true,"source":"GYAHTEI.txt","id":1183},
{"name":"行の先頭セルへ移動","area":"テキストと表","shortcutText":"表: Opt+Home","defined":true,"actionId":66849,"actionIdExpression":"0x10500 + 33","internalName":"KBSCE Text and Tables:Move to First Cell in Row","aliases":["行の先頭セルへ移動","KBSCE Text and Tables:Move to First Cell in Row"],"executable":true,"source":"GYAHTEI.txt","id":1184},
{"name":"行の最終セルへ移動","area":"テキストと表","shortcutText":"表: Opt+End","defined":true,"actionId":66850,"actionIdExpression":"0x10500 + 34","internalName":"KBSCE Text and Tables:Move to Last Cell in Row","aliases":["行の最終セルへ移動","KBSCE Text and Tables:Move to Last Cell in Row"],"executable":true,"source":"GYAHTEI.txt","id":1185},
{"name":"行の終わりまで選択","area":"テキストと表","shortcutText":"テキスト: Shift+End","defined":true,"actionId":119573,"actionIdExpression":"0x1d300 + 21","internalName":"KBSCE Text and Tables:Select to the end of the line","aliases":["行の終わりまで選択","KBSCE Text and Tables:Select to the end of the line"],"executable":true,"source":"GYAHTEI.txt","id":1186},
{"name":"行の選択","area":"テキストと表","shortcutText":"テキスト: Shift+Cmd+\\","defined":true,"actionId":119661,"actionIdExpression":"0x1d300 + 109","internalName":"KBSCE Text and Tables:Select line","aliases":["行の選択","KBSCE Text and Tables:Select line"],"executable":true,"source":"GYAHTEI.txt","id":1187},
{"name":"行を挿入","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1188},
{"name":"行末へ移動","area":"テキストと表","shortcutText":"テキスト: End","defined":true,"actionId":119563,"actionIdExpression":"0x1d300 + 11","internalName":"KBSCE Text and Tables:Move to the end of the line","aliases":["行末へ移動","KBSCE Text and Tables:Move to the end of the line"],"executable":true,"source":"GYAHTEI.txt","id":1189},
{"name":"行送り x 5 増加","area":"テキストと表","shortcutText":"テキスト: Opt+Cmd+下向き矢印","defined":true,"actionId":119647,"actionIdExpression":"0x1d300 + 95","internalName":"KBSCE Text and Tables:Increase leading x 5","aliases":["行送り x 5 増加","KBSCE Text and Tables:Increase leading x 5"],"executable":true,"source":"GYAHTEI.txt","id":1190},
{"name":"行送り x 5 減少","area":"テキストと表","shortcutText":"テキスト: Opt+Cmd+上向き矢印","defined":true,"actionId":119648,"actionIdExpression":"0x1d300 + 96","internalName":"KBSCE Text and Tables:Decrease leading x 5","aliases":["行送り x 5 減少","KBSCE Text and Tables:Decrease leading x 5"],"executable":true,"source":"GYAHTEI.txt","id":1191},
{"name":"行送りの増加","area":"テキストと表","shortcutText":"テキスト: Opt+下向き矢印","defined":true,"actionId":119635,"actionIdExpression":"0x1d300 + 83","internalName":"KBSCE Text and Tables:Increase leading","aliases":["行送りの増加","KBSCE Text and Tables:Increase leading"],"executable":true,"source":"GYAHTEI.txt","id":1192},
{"name":"行送りの減少","area":"テキストと表","shortcutText":"テキスト: Opt+上向き矢印","defined":true,"actionId":119636,"actionIdExpression":"0x1d300 + 84","internalName":"KBSCE Text and Tables:Decrease leading","aliases":["行送りの減少","KBSCE Text and Tables:Decrease leading"],"executable":true,"source":"GYAHTEI.txt","id":1193},
{"name":"行頭へ移動","area":"テキストと表","shortcutText":"テキスト: Home","defined":true,"actionId":119562,"actionIdExpression":"0x1d300 + 10","internalName":"KBSCE Text and Tables:Move to the start of the line","aliases":["行頭へ移動","KBSCE Text and Tables:Move to the start of the line"],"executable":true,"source":"GYAHTEI.txt","id":1194},
{"name":"調整量を優先","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1195},
{"name":"追い出しのみ","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1196},
{"name":"追い出し優先","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1197},
{"name":"追い込み優先","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1198},
{"name":"連数字処理 (欧文数字を除く)","area":"テキストと表","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1199},
{"name":"選択したテキストを検索文字列に読み込み","area":"テキストと表","shortcutText":"テキスト: Cmd+F1","defined":true,"actionId":18689,"actionIdExpression":"0x4900 + 1","internalName":"KBSCE Text and Tables:Load Find with selected text","aliases":["選択したテキストを検索文字列に読み込み","KBSCE Text and Tables:Load Find with selected text"],"executable":true,"source":"GYAHTEI.txt","id":1200},
{"name":"選択したテキストを置換文字列に読み込み","area":"テキストと表","shortcutText":"テキスト: Cmd+F2","defined":true,"actionId":18693,"actionIdExpression":"0x4900 + 5","internalName":"KBSCE Text and Tables:Load Replace with selected text","aliases":["選択したテキストを置換文字列に読み込み","KBSCE Text and Tables:Load Replace with selected text"],"executable":true,"source":"GYAHTEI.txt","id":1201},
{"name":"頭末合わせ","area":"テキストと表","shortcutText":"デフォルト: Shift+Cmd+F","defined":true,"actionId":119626,"actionIdExpression":"0x1d300 + 74","internalName":"KBSCE Text and Tables:Align force justify","aliases":["頭末合わせ","KBSCE Text and Tables:Align force justify"],"executable":true,"source":"GYAHTEI.txt","id":1202},
{"name":"Content Editing","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1203},
{"name":"Content Editing: Assign To: New...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1204},
{"name":"Content Editing: Delete Collaborator","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1205},
{"name":"Content Editing: Edit Collaborator","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1206},
{"name":"Content Editing: Go to Story","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1207},
{"name":"Content Editing: Remove Story","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1208},
{"name":"Content Editing: Stop Collaboration","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1209},
{"name":"EPUB インタラクティビティプレビュー: スプレッドをプレビュー : EPUB","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1210},
{"name":"アサイン: InCopy 用にパッケージ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1211},
{"name":"アサイン: InCopy 用にパッケージして電子メールを送信","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1212},
{"name":"アサイン: すべてのアサインを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1213},
{"name":"アサイン: すべてをチェックイン","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1214},
{"name":"アサイン: アサインに追加: 新規...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1215},
{"name":"アサイン: アサインを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1216},
{"name":"アサイン: アサインオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1217},
{"name":"アサイン: アサイン場所を変更...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1218},
{"name":"アサイン: コンテンツへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1219},
{"name":"アサイン: コンテンツを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1220},
{"name":"アサイン: チェックアウト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1221},
{"name":"アサイン: チェックアウトをキャンセル","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1222},
{"name":"アサイン: チェックイン","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1223},
{"name":"アサイン: パッケージをキャンセル","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1224},
{"name":"アサイン: パッケージを開く...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1225},
{"name":"アサイン: 内容を埋め込み","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1226},
{"name":"アサイン: 新規アサイン...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1227},
{"name":"アサイン: 期限切れのアサインを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1228},
{"name":"アサイン: 選択したアサインを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1229},
{"name":"アニメーション: プリセットを管理...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1230},
{"name":"アニメーション: モーションパスに変換","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1231},
{"name":"アニメーション: 保存","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1232},
{"name":"アーティクル: アイテムへ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1233},
{"name":"アーティクル: アーティクルオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1234},
{"name":"アーティクル: タグ付き PDF のタグ付け順序に使用","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1235},
{"name":"アーティクル: ドキュメントコンテンツを選択したアーティクルに追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1236},
{"name":"アーティクル: 削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1237},
{"name":"アーティクル: 新規アーティクル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1238},
{"name":"アーティクル: 選択範囲を選択したアーティクルに追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1239},
{"name":"オブジェクトスタイル: すべてのグループを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1240},
{"name":"オブジェクトスタイル: すべてのグループを開く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1241},
{"name":"オブジェクトスタイル: オブジェクトスタイルの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1242},
{"name":"オブジェクトスタイル: オブジェクトスタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1243},
{"name":"オブジェクトスタイル: オーバーライドを消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1244},
{"name":"オブジェクトスタイル: グループにコピー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1245},
{"name":"オブジェクトスタイル: スタイルからグループを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1246},
{"name":"オブジェクトスタイル: スタイルで定義されていない属性を消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1247},
{"name":"オブジェクトスタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1248},
{"name":"オブジェクトスタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1249},
{"name":"オブジェクトスタイル: スタイルの適用時にオーバーライドを消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1250},
{"name":"オブジェクトスタイル: スタイルを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1251},
{"name":"オブジェクトスタイル: スタイル再定義","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1252},
{"name":"オブジェクトスタイル: 新規オブジェクトスタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1253},
{"name":"オブジェクトスタイル: 新規スタイルグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1254},
{"name":"オブジェクトステート: すべてのオブジェクトをステートにリリース","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1255},
{"name":"オブジェクトステート: すべてのマルチステートオブジェクトを最初のステートにリセット","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1256},
{"name":"オブジェクトステート: オブジェクトをステートに追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1257},
{"name":"オブジェクトステート: ステートにペースト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1258},
{"name":"オブジェクトステート: ステートをオブジェクトにリリース","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1259},
{"name":"オブジェクトステート: ステートを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1260},
{"name":"オブジェクトステート: トリガーされるまで非表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1261},
{"name":"オブジェクトステート: パネルオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1262},
{"name":"オブジェクトステート: 新規ステート","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1263},
{"name":"カラー: オプションを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1264},
{"name":"カラー: スウォッチに追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1265},
{"name":"グラデーション: オプションを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1266},
{"name":"グリッドフォーマット: グリッドフォーマットの削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1267},
{"name":"グリッドフォーマット: グリッドフォーマットの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1268},
{"name":"グリッドフォーマット: グリッドフォーマットの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1269},
{"name":"グリッドフォーマット: グリッドフォーマットを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1270},
{"name":"グリッドフォーマット: 新規グリッドフォーマット...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1271},
{"name":"グリッドフォーマット: 未使用をすべて選択","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1272},
{"name":"コントロール: カスタマイズ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1273},
{"name":"コントロール: フロート","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1274},
{"name":"コントロール: 上部で結合","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1275},
{"name":"コントロール: 下部で結合","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1276},
{"name":"スウォッチ: このカラーを検索...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1277},
{"name":"スウォッチ: すべてのスウォッチ (カラー値順)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1278},
{"name":"スウォッチ: すべてのスウォッチ (名前順)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1279},
{"name":"スウォッチ: すべてのスウォッチを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1280},
{"name":"スウォッチ: インキ管理...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1281},
{"name":"スウォッチ: オプションを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1282},
{"name":"スウォッチ: カラーグループを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1283},
{"name":"スウォッチ: カラーグループを解除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1284},
{"name":"スウォッチ: カラーグループオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1285},
{"name":"スウォッチ: カラースウォッチを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1286},
{"name":"スウォッチ: グラデーションスウォッチを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1287},
{"name":"スウォッチ: サムネール (大) を表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1288},
{"name":"スウォッチ: サムネール (小) を表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1289},
{"name":"スウォッチ: スウォッチの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1290},
{"name":"スウォッチ: スウォッチを保存...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1291},
{"name":"スウォッチ: スウォッチを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1292},
{"name":"スウォッチ: スウォッチを結合","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1293},
{"name":"スウォッチ: スウォッチを複製","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1294},
{"name":"スウォッチ: スウォッチ設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1295},
{"name":"スウォッチ: リスト (大) を表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1296},
{"name":"スウォッチ: リスト (小) を表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1297},
{"name":"スウォッチ: 名称未設定カラーを追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1298},
{"name":"スウォッチ: 新規カラーグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1299},
{"name":"スウォッチ: 新規カラースウォッチ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1300},
{"name":"スウォッチ: 新規カラースウォッチ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1301},
{"name":"スウォッチ: 新規グラデーションスウォッチ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1302},
{"name":"スウォッチ: 新規混合インキグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1303},
{"name":"スウォッチ: 新規混合インキスウォッチ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1304},
{"name":"スウォッチ: 新規濃淡スウォッチ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1305},
{"name":"スウォッチ: 未使用をすべて選択","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1306},
{"name":"スウォッチ: 選択したスウォッチ (カラー値順)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1307},
{"name":"スウォッチ: 選択したスウォッチ (名前順)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1308},
{"name":"スクリプト: Finder で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1309},
{"name":"スクリプト: サポートされていないファイルを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1310},
{"name":"スクリプト: スクリプトを実行","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1311},
{"name":"スクリプト: スクリプトを編集","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1312},
{"name":"スクリプト: スクリプトファイルを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1313},
{"name":"スクリプト: 再描画を有効にする","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1314},
{"name":"セルスタイル: すべてのスタイルグループを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1315},
{"name":"セルスタイル: すべてのスタイルグループを開く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1316},
{"name":"セルスタイル: オーバーライドを消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1317},
{"name":"セルスタイル: グループにコピー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1318},
{"name":"セルスタイル: スタイルからグループを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1319},
{"name":"セルスタイル: スタイルで定義されていない属性を消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1320},
{"name":"セルスタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1321},
{"name":"セルスタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1322},
{"name":"セルスタイル: スタイルを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1323},
{"name":"セルスタイル: スタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1324},
{"name":"セルスタイル: スタイル再定義","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1325},
{"name":"セルスタイル: セルスタイルを読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1326},
{"name":"セルスタイル: 名前順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1327},
{"name":"セルスタイル: 新規スタイルグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1328},
{"name":"セルスタイル: 新規セルスタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1329},
{"name":"タイミング: ページの読み込み時に再割り当て","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1330},
{"name":"タイミング: ページクリック時に再割り当て","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1331},
{"name":"タイミング: 項目の削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1332},
{"name":"タグ: タグの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1333},
{"name":"タグ: タグを保存...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1334},
{"name":"タグ: タグを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1335},
{"name":"タグ: タグ設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1336},
{"name":"タグ: フレームのタグを取り除く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1337},
{"name":"タグ: 小さく表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1338},
{"name":"タグ: 新規タグ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1339},
{"name":"タグ: 未使用のタグをすべて選択","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1340},
{"name":"タグ: 自動タグ","area":"パネルメニュー","shortcutText":"テキスト: Opt+Shift+Cmd+F7","defined":true,"actionId":78815,"actionIdExpression":"0x13300 + 223","internalName":"KBSCE Palette Menus: Tag: :Tag_AutoTag","aliases":["自動タグ","KBSCE Palette Menus: Tag: :Tag_AutoTag"],"executable":true,"source":"GYAHTEI.txt","id":1341},
{"name":"タブ: すべてを消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1342},
{"name":"タブ: インデントをリセット","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1343},
{"name":"タブ: タブを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1344},
{"name":"タブ: 中央揃えタブ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1345},
{"name":"タブ: 右 / 下揃えタブ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1346},
{"name":"タブ: 小数点揃えタブ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1347},
{"name":"タブ: 左 / 上揃えタブ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1348},
{"name":"タブ: 繰り返し","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1349},
{"name":"テキストから画像生成","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1350},
{"name":"データ結合: PDF に書き出し","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1351},
{"name":"データ結合: コンテンツ配置オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1352},
{"name":"データ結合: データソースを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1353},
{"name":"データ結合: データソースを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1354},
{"name":"データ結合: データソースを選択...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1355},
{"name":"データ結合: データフィールドの内容を更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1356},
{"name":"データ結合: プレビュー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1357},
{"name":"データ結合: 更新結果のログを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1358},
{"name":"データ結合: 結合ドキュメントを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1359},
{"name":"トラッププリセット: トラッププリセットを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1360},
{"name":"トラッププリセット: トラッププリセットを割り当て...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1361},
{"name":"トラッププリセット: トラッププリセットを編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1362},
{"name":"トラッププリセット: トラッププリセットを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1363},
{"name":"トラッププリセット: トラッププリセットを読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1364},
{"name":"トラッププリセット: 新規トラッププリセット...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1365},
{"name":"トラッププリセット: 未使用プリセットをすべて選択","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1366},
{"name":"ハイパーリンク: URL から新規ハイパーリンクを作成","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1367},
{"name":"ハイパーリンク: URL ステータスを自動更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1368},
{"name":"ハイパーリンク: ハイパーリンクをリセット","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1369},
{"name":"ハイパーリンク: ハイパーリンクを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1370},
{"name":"ハイパーリンク: ハイパーリンクを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1371},
{"name":"ハイパーリンク: ハイパーリンクを編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1372},
{"name":"ハイパーリンク: ハイパーリンク元へ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1373},
{"name":"ハイパーリンク: ハイパーリンク先へ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1374},
{"name":"ハイパーリンク: ハイパーリンク先オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1375},
{"name":"ハイパーリンク: ハイパーリンク名の変更...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1376},
{"name":"ハイパーリンク: 名前順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1377},
{"name":"ハイパーリンク: 小さく表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1378},
{"name":"ハイパーリンク: 形式順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1379},
{"name":"ハイパーリンク: 手動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1380},
{"name":"ハイパーリンク: 新規ハイパーリンク...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1381},
{"name":"ハイパーリンク: 新規ハイパーリンク先...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1382},
{"name":"ハイパーリンク: 未使用のリンク先を削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1383},
{"name":"ハイパーリンク: 相互参照元へ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1384},
{"name":"ハイパーリンク: 相互参照先へ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1385},
{"name":"バージョン履歴","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1386},
{"name":"ブック: DeleteHyperlinkFromPropsPanel","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1387},
{"name":"ブック: Finder で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1388},
{"name":"ブック: すべての番号を更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1389},
{"name":"ブック: すべての相互参照を更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1390},
{"name":"ブック: ドキュメントの置換...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1391},
{"name":"ブック: ドキュメントの自動番号設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1392},
{"name":"ブック: ドキュメントの追加...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1393},
{"name":"ブック: ドキュメントを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1394},
{"name":"ブック: ドキュメント情報...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1395},
{"name":"ブック: ブックのページ番号設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1396},
{"name":"ブック: ブックを保存","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1397},
{"name":"ブック: ブックを別名で保存...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1398},
{"name":"ブック: ブックを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1399},
{"name":"ブック: ページとセクション番号を更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1400},
{"name":"ブック: 同期オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1401},
{"name":"ブック: 書き出し時に同一名のレイヤーを結合する","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1402},
{"name":"ブック: 章と段落番号を更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1403},
{"name":"ブック: 自動ドキュメント変換","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1404},
{"name":"ブックマーク: ブックマークを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1405},
{"name":"ブックマーク: ブックマークを整理","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1406},
{"name":"ブックマーク: ブックマーク名の変更","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1407},
{"name":"ブックマーク: 新規ブックマーク","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1408},
{"name":"ブックマーク: 選択されたブックマークへ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1409},
{"name":"プラグインパネル","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1410},
{"name":"プリフライト: 100","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1411},
{"name":"プリフライト: 25","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1412},
{"name":"プリフライト: 50","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1413},
{"name":"プリフライト: すべてのドキュメントのプリフライトを有効にする","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1414},
{"name":"プリフライト: プリフライトオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1415},
{"name":"プリフライト: プロファイルを管理...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1416},
{"name":"プリフライト: レポートを保存...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1417},
{"name":"プリフライト: 制限なし","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1418},
{"name":"ページ: 「I-広告ページ-2」の親ページ設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1419},
{"name":"ページ: すべてのオブジェクトを親ページから分離","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1420},
{"name":"ページ: すべてのページアイテムをオーバーライド","area":"パネルメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+L","defined":true,"actionId":6164,"actionIdExpression":"0x1800 + 20","internalName":"KBSCE Palette Menus: Pages: :Override All Master Page Items","aliases":["すべてのページアイテムをオーバーライド","KBSCE Palette Menus: Pages: :Override All Master Page Items"],"executable":true,"source":"GYAHTEI.txt","id":1421},
{"name":"ページ: すべてのローカルオーバーライドを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1422},
{"name":"ページ: オフ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1423},
{"name":"ページ: オブジェクトごと","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1424},
{"name":"ページ: ガイドごと","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1425},
{"name":"ページ: スプレッドの透明を統合: カスタム...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1426},
{"name":"ページ: スプレッドの透明を統合: デフォルト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1427},
{"name":"ページ: スプレッドの透明を統合: 統合なし (透明を無視)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1428},
{"name":"ページ: スプレッドをプリント...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1429},
{"name":"ページ: スプレッドを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1430},
{"name":"ページ: スプレッドビューを回転: 180°","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1431},
{"name":"ページ: スプレッドビューを回転: 180°","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1432},
{"name":"ページ: スプレッドビューを回転: 90°(反時計回り)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1433},
{"name":"ページ: スプレッドビューを回転: 90°(時計回り)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1434},
{"name":"ページ: スプレッドビューを回転: 90°反時計回り","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1435},
{"name":"ページ: スプレッドビューを回転: 90°時計回り","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1436},
{"name":"ページ: スプレッドビューを回転: 回転を取り消し","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1437},
{"name":"ページ: ドキュメントページの移動を許可","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1438},
{"name":"ページ: ページを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1439},
{"name":"ページ: ページを挿入...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1440},
{"name":"ページ: ページを移動...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1441},
{"name":"ページ: ページ番号とセクションの設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1442},
{"name":"ページ: 中央揃え","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1443},
{"name":"ページ: 代替レイアウトを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1444},
{"name":"ページ: 代替レイアウトを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1445},
{"name":"ページ: 拡大・縮小","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1446},
{"name":"ページ: 新規親ページ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1447},
{"name":"ページ: 親スプレッド「I-広告ページ-2」を削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1448},
{"name":"ページ: 親スプレッド「I-広告ページ-2」を複製","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1449},
{"name":"ページ: 親スプレッド「I-広告ページ-2」を複製 (ドキュメントの最後)","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1450},
{"name":"ページ: 親スプレッドを隠す \"I-広告ページ-2\"","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1451},
{"name":"ページ: 親ページとして保存","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1452},
{"name":"ページ: 親ページによって制御","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1453},
{"name":"ページ: 親ページを読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1454},
{"name":"ページ: 親ページを適用...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1455},
{"name":"ページ: 親ページアイテムを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1456},
{"name":"ページ: 選択範囲の親ページアイテムのオーバーライドを許可","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1457},
{"name":"ボタン: すべてのボタンを通常のステートにリセット","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1458},
{"name":"ボタン: アクション:   URL へ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1459},
{"name":"ボタン: アクション:   アニメーション","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1460},
{"name":"ボタン: アクション:   サウンド","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1461},
{"name":"ボタン: アクション:   ステートに移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1462},
{"name":"ボタン: アクション:   ズーム表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1463},
{"name":"ボタン: アクション:   ビデオ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1464},
{"name":"ボタン: アクション:   ファイルを開く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1465},
{"name":"ボタン: アクション:   フォームをクリア","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1466},
{"name":"ボタン: アクション:   フォームをプリント","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1467},
{"name":"ボタン: アクション:   フォームを送信","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1468},
{"name":"ボタン: アクション:   ページへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1469},
{"name":"ボタン: アクション:   ボタンとフォームを表示 / 隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1470},
{"name":"ボタン: アクション:   先頭ページへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1471},
{"name":"ボタン: アクション:   前のステートに移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1472},
{"name":"ボタン: アクション:   前の表示へ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1473},
{"name":"ボタン: アクション:   前ページへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1474},
{"name":"ボタン: アクション:   最終ページへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1475},
{"name":"ボタン: アクション:   次のステートに移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1476},
{"name":"ボタン: アクション:   次の表示へ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1477},
{"name":"ボタン: アクション:   次ページへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1478},
{"name":"ボタン: アクション:   配置先へ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1479},
{"name":"ボタン: サンプルボタンとフォーム","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1480},
{"name":"ボタン: パネルオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1481},
{"name":"ライブラリ: すべてを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1482},
{"name":"ライブラリ: アイテムの割り付け","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1483},
{"name":"ライブラリ: アイテムを CC ライブラリに移行","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1484},
{"name":"ライブラリ: アイテムを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1485},
{"name":"ライブラリ: アイテム情報...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1486},
{"name":"ライブラリ: サブセットを表示...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1487},
{"name":"ライブラリ: サムネール (大) を表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1488},
{"name":"ライブラリ: サムネール表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1489},
{"name":"ライブラリ: ページ上のアイテムを別々のオブジェクトとして追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1490},
{"name":"ライブラリ: ページ上のアイテムを追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1491},
{"name":"ライブラリ: ライブラリを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1492},
{"name":"ライブラリ: ライブラリアイテムを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1493},
{"name":"ライブラリ: リスト表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1494},
{"name":"ライブラリ: 古い順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1495},
{"name":"ライブラリ: 名前順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1496},
{"name":"ライブラリ: 形式順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1497},
{"name":"ライブラリ: 新しい順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1498},
{"name":"ライブラリ: 項目を追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1499},
{"name":"リンク: Adobe Asset Link から再リンク...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1500},
{"name":"リンク: Bridge で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1501},
{"name":"リンク: CC ライブラリから再リンク…","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1502},
{"name":"リンク: CC ライブラリで表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1503},
{"name":"リンク: CC ライブラリで表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1504},
{"name":"リンク: FPO をオリジナルに置換...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1505},
{"name":"リンク: Finder で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1506},
{"name":"リンク: XMP ファイル情報...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1507},
{"name":"リンク: この列を隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1508},
{"name":"リンク: すべての FPO をオリジナルに置換...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1509},
{"name":"リンク: すべてのオリジナルをダウンロード","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1510},
{"name":"リンク: すべてのリンクを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1511},
{"name":"リンク: すべてのリンク情報をコピー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1512},
{"name":"リンク: オリジナルをダウンロード","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1513},
{"name":"リンク: キャプションの作成","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1514},
{"name":"リンク: サムネールを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1515},
{"name":"リンク: ソースに移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1516},
{"name":"リンク: チェックアウト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1517},
{"name":"リンク: チェックアウトをキャンセル","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1518},
{"name":"リンク: チェックイン","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1519},
{"name":"リンク: バージョン...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1520},
{"name":"リンク: パネルオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1521},
{"name":"リンク: ファイル拡張子にリンクを再設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1522},
{"name":"リンク: フィールドにコピー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1523},
{"name":"リンク: フォルダーに再リンク...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1524},
{"name":"リンク: フルパスをコピー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1525},
{"name":"リンク: プラットフォームのスタイルパスをコピー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1526},
{"name":"リンク: プロパティパネルからファイルをリンク解除する","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1527},
{"name":"リンク: プロパティパネルから画像を再度リンクする","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1528},
{"name":"リンク: プロパティパネルから画像を埋め込みます","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1529},
{"name":"リンク: プロパティパネルから画像を更新する","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1530},
{"name":"リンク: ライブキャプションの作成","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1531},
{"name":"リンク: リンクへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1532},
{"name":"リンク: リンクをチェックイン...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1533},
{"name":"リンク: リンクを埋め込み","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1534},
{"name":"リンク: リンクを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1535},
{"name":"リンク: リンクオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1536},
{"name":"リンク: リンク情報ウィンドウを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1537},
{"name":"リンク: 元データを編集","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1538},
{"name":"リンク: 再リンク...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1539},
{"name":"リンク: 再リンク...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1540},
{"name":"リンク: 場所を指定してリンクをコピー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1541},
{"name":"リンク: 情報サムネールを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1542},
{"name":"リンク: 無効なリンクを検索","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1543},
{"name":"リンク: 画像をライセンス認証...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1544},
{"name":"リンク: 自動サイズリンク情報","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1545},
{"name":"リンク: 選択されたリンクの情報をコピー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1546},
{"name":"レイアウトウィンドウのステータス: Bridge で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1547},
{"name":"レイアウトウィンドウのステータス: Finder で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1548},
{"name":"レイアウトウィンドウのステータス: バージョン...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1549},
{"name":"レイアウトウィンドウのプリフライトステータス: すべてのドキュメントのプリフライトを有効にする","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1550},
{"name":"レイアウトウィンドウのプリフライトステータス: ドキュメントのプリフライト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1551},
{"name":"レイヤー: \"レイヤー 1\" のレイヤーオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1552},
{"name":"レイヤー: \"レイヤー 1\" の下に新規レイヤー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1553},
{"name":"レイヤー: アイテムを選択","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1554},
{"name":"レイヤー: アイテムを選択して合わせる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1555},
{"name":"レイヤー: コピー元のレイヤーにペースト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1556},
{"name":"レイヤー: レイヤー \"レイヤー 1\" を複製","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1557},
{"name":"レイヤー: レイヤー \"レイヤー 1\"を削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1558},
{"name":"レイヤー: レイヤーの結合","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1559},
{"name":"レイヤー: 他をロック","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1560},
{"name":"レイヤー: 他を隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1561},
{"name":"レイヤー: 元のレイヤーに戻してグループ解除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1562},
{"name":"レイヤー: 小さく表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1563},
{"name":"レイヤー: 未使用レイヤーを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1564},
{"name":"レビュー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1565},
{"name":"分割プレビュー: 透明の分割・統合プリセット...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1566},
{"name":"分版プレビュー: リッチブラックをシミュレート","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1567},
{"name":"分版プレビュー: 単数プレートを黒で表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1568},
{"name":"効果: オブジェクト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1569},
{"name":"効果: オプションを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1570},
{"name":"効果: グラデーションぼかし...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1571},
{"name":"効果: サテン...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1572},
{"name":"効果: シャドウ (内側)...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1573},
{"name":"効果: テキスト","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1574},
{"name":"効果: ドロップシャドウ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1575},
{"name":"効果: ベベルとエンボス...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1576},
{"name":"効果: 光彩 (内側)...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1577},
{"name":"効果: 光彩 (外側)...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1578},
{"name":"効果: 効果を消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1579},
{"name":"効果: 基本のぼかし...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1580},
{"name":"効果: 塗り","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1581},
{"name":"効果: 方向性のぼかし...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1582},
{"name":"効果: 線","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1583},
{"name":"効果: 透明...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1584},
{"name":"変形: スケールを 100% に再定義","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1585},
{"name":"変形: 変形を消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1586},
{"name":"字形: CID/GID 順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1587},
{"name":"字形: Unicode 順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1588},
{"name":"字形: オプションを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1589},
{"name":"字形: 新規字形セット...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1590},
{"name":"字形: 最近使用した 1 番目の字形を挿入","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1591},
{"name":"字形: 最近使用した 2 番目の字形を挿入","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1592},
{"name":"字形: 最近使用した 3 番目の字形を挿入","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1593},
{"name":"字形: 最近使用した 4 番目の字形を挿入","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1594},
{"name":"字形: 最近使用した 5 番目の字形を挿入","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1595},
{"name":"文字: OpenType: [すべてスモールキャップス]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1596},
{"name":"文字: OpenType: [スワッシュ字形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1597},
{"name":"文字: OpenType: [セット 10]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1598},
{"name":"文字: OpenType: [セット 11]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1599},
{"name":"文字: OpenType: [セット 12]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1600},
{"name":"文字: OpenType: [セット 13]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1601},
{"name":"文字: OpenType: [セット 14]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1602},
{"name":"文字: OpenType: [セット 15]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1603},
{"name":"文字: OpenType: [セット 16]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1604},
{"name":"文字: OpenType: [セット 17]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1605},
{"name":"文字: OpenType: [セット 18]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1606},
{"name":"文字: OpenType: [セット 19]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1607},
{"name":"文字: OpenType: [セット 1]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1608},
{"name":"文字: OpenType: [セット 20]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1609},
{"name":"文字: OpenType: [セット 2]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1610},
{"name":"文字: OpenType: [セット 3]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1611},
{"name":"文字: OpenType: [セット 4]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1612},
{"name":"文字: OpenType: [セット 5]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1613},
{"name":"文字: OpenType: [セット 6]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1614},
{"name":"文字: OpenType: [セット 7]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1615},
{"name":"文字: OpenType: [セット 8]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1616},
{"name":"文字: OpenType: [セット 9]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1617},
{"name":"文字: OpenType: [タイトル用字形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1618},
{"name":"文字: OpenType: [デフォルトの数字]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1619},
{"name":"文字: OpenType: [プロポーショナルオールドスタイル数字]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1620},
{"name":"文字: OpenType: [プロポーショナルライニング数字]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1621},
{"name":"文字: OpenType: [一般形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1622},
{"name":"文字: OpenType: [上付き序数表記]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1623},
{"name":"文字: OpenType: [前後関係に依存する字形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1624},
{"name":"文字: OpenType: [古典字形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1625},
{"name":"文字: OpenType: [独立形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1626},
{"name":"文字: OpenType: [等幅オールドスタイル数字]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1627},
{"name":"文字: OpenType: [等幅ライニング数字]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1628},
{"name":"文字: OpenType: [自動形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1629},
{"name":"文字: OpenType: [語中形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1630},
{"name":"文字: OpenType: [語尾形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1631},
{"name":"文字: OpenType: [語頭形]","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1632},
{"name":"文字: OpenType: スラッシュを用いた分数","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1633},
{"name":"文字: OpenType: スラッシュ付きゼロ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1634},
{"name":"文字: OpenType: 上付き文字","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1635},
{"name":"文字: OpenType: 下付き文字","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1636},
{"name":"文字: OpenType: 任意の合字","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1637},
{"name":"文字: OpenType: 分子","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1638},
{"name":"文字: OpenType: 分母","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1639},
{"name":"文字: オールキャップス","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1640},
{"name":"文字: スモールキャップス","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1641},
{"name":"文字: 上付き文字","area":"パネルメニュー","shortcutText":"デフォルト: Shift+Cmd+=","defined":true,"actionId":119616,"actionIdExpression":"0x1d300 + 64","internalName":"KBSCE Palette Menus: Character: :Apply superscript","aliases":["上付き文字","KBSCE Palette Menus: Character: :Apply superscript"],"executable":true,"source":"GYAHTEI.txt","id":1642},
{"name":"文字: 下付き文字","area":"パネルメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+=","defined":true,"actionId":119617,"actionIdExpression":"0x1d300 + 65","internalName":"KBSCE Palette Menus: Character: :Apply subscript","aliases":["下付き文字","KBSCE Palette Menus: Character: :Apply subscript"],"executable":true,"source":"GYAHTEI.txt","id":1643},
{"name":"文字: 下線","area":"パネルメニュー","shortcutText":"デフォルト: Shift+Cmd+U","defined":true,"actionId":119612,"actionIdExpression":"0x1d300 + 60","internalName":"KBSCE Palette Menus: Character: :Apply underline","aliases":["下線","KBSCE Palette Menus: Character: :Apply underline"],"executable":true,"source":"GYAHTEI.txt","id":1644},
{"name":"文字: 下線設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1645},
{"name":"文字: 分割禁止","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1646},
{"name":"文字: 小文字","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1647},
{"name":"文字: 打ち消し線","area":"パネルメニュー","shortcutText":"デフォルト: Ctrl+Shift+Cmd+/, デフォルト: Shift+Cmd+/","defined":true,"actionId":119618,"actionIdExpression":"0x1d300 + 66","internalName":"KBSCE Palette Menus: Character: :Apply strikethru","aliases":["打ち消し線","KBSCE Palette Menus: Character: :Apply strikethru"],"executable":true,"source":"GYAHTEI.txt","id":1648},
{"name":"文字: 打ち消し線設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1649},
{"name":"文字: 欧文合字","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1650},
{"name":"文字スタイル: すべてのスタイルグループを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1651},
{"name":"文字スタイル: すべてのスタイルグループを開く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1652},
{"name":"文字スタイル: グループにコピー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1653},
{"name":"文字スタイル: スタイルからグループを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1654},
{"name":"文字スタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1655},
{"name":"文字スタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1656},
{"name":"文字スタイル: スタイルのオーバーライドマーカーの切り替え","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1657},
{"name":"文字スタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1658},
{"name":"文字スタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1659},
{"name":"文字スタイル: スタイルを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1660},
{"name":"文字スタイル: スタイルを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1661},
{"name":"文字スタイル: スタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1662},
{"name":"文字スタイル: スタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1663},
{"name":"文字スタイル: スタイル再定義","area":"パネルメニュー","shortcutText":"テキスト: Opt+Shift+Cmd+C","defined":true,"actionId":8459,"actionIdExpression":"0x2100 + 11","internalName":"KBSCE Palette Menus: Character Styles: :Redefine Style","aliases":["スタイル再定義","KBSCE Palette Menus: Character Styles: :Redefine Style"],"executable":true,"source":"GYAHTEI.txt","id":1664},
{"name":"文字スタイル: 名前順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1665},
{"name":"文字スタイル: 文字スタイルの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1666},
{"name":"文字スタイル: 文字スタイルの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1667},
{"name":"文字スタイル: 新規スタイルグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1668},
{"name":"文字スタイル: 新規文字スタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1669},
{"name":"条件テキスト: すべてを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1670},
{"name":"条件テキスト: すべてを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1671},
{"name":"条件テキスト: オプションを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1672},
{"name":"条件テキスト: 新規条件...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1673},
{"name":"条件テキスト: 未使用をすべて選択","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1674},
{"name":"条件テキスト: 条件およびセットを読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1675},
{"name":"条件テキスト: 条件を削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1676},
{"name":"条件テキスト: 条件を読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1677},
{"name":"条件テキスト: 条件オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1678},
{"name":"条件テキスト: 条件テキスト上にインジケーターを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1679},
{"name":"条件テキスト: 条件テキスト上にインジケーターを表示してプリント","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1680},
{"name":"条件テキスト: 条件テキスト上のインジケーターを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1681},
{"name":"段落: 1 行目のみグリッドに揃える","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1682},
{"name":"段落: Adobe 多言語対応単数行コンポーザー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1683},
{"name":"段落: Adobe 多言語対応段落コンポーザー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1684},
{"name":"段落: Adobe 日本語単数行コンポーザー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1685},
{"name":"段落: Adobe 日本語段落コンポーザー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1686},
{"name":"段落: Adobe 欧文単数行コンポーザー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1687},
{"name":"段落: Adobe 欧文段落コンポーザー","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1688},
{"name":"段落: オプションを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1689},
{"name":"段落: オプティカルマージンを無視","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1690},
{"name":"段落: ジャスティフィケーション...","area":"パネルメニュー","shortcutText":"デフォルト: Opt+Shift+Cmd+J","defined":true,"actionId":27142,"actionIdExpression":"0x6a00 + 6","internalName":"KBSCE Palette Menus: Paragraph: :Roman Justification...","aliases":["ジャスティフィケーション...","KBSCE Palette Menus: Paragraph: :Roman Justification..."],"executable":true,"source":"GYAHTEI.txt","id":1691},
{"name":"段落: ドロップキャップと先頭文字スタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1692},
{"name":"段落: ハイフネーション","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1693},
{"name":"段落: ハイフネーション設定...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1694},
{"name":"段落: 全角スペースを行末吸収","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1695},
{"name":"段落: 欧文泣き別れ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1696},
{"name":"段落: 正規表現スタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1697},
{"name":"段落: 段抜きと段分割...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1698},
{"name":"段落: 段落の囲み罫と背景色...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1699},
{"name":"段落: 段落分離禁止オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1700},
{"name":"段落: 段落境界線...","area":"パネルメニュー","shortcutText":"デフォルト: Opt+Cmd+J","defined":true,"actionId":27141,"actionIdExpression":"0x6a00 + 5","internalName":"KBSCE Palette Menus: Paragraph: :Paragraph Rules...","aliases":["段落境界線...","KBSCE Palette Menus: Paragraph: :Paragraph Rules..."],"executable":true,"source":"GYAHTEI.txt","id":1701},
{"name":"段落: 段落行取り","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1702},
{"name":"段落: 箇条書き...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1703},
{"name":"段落: 行末を揃える","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1704},
{"name":"段落スタイル: 「[基本段落]」の 箇条書き をテキストに変換","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1705},
{"name":"段落スタイル: すべてのスタイルグループを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1706},
{"name":"段落スタイル: すべてのスタイルグループを開く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1707},
{"name":"段落スタイル: オーバーライドを消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1708},
{"name":"段落スタイル: グループにコピー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1709},
{"name":"段落スタイル: スタイルからグループを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1710},
{"name":"段落スタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1711},
{"name":"段落スタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1712},
{"name":"段落スタイル: スタイルのオーバーライドマーカーの切り替え","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1713},
{"name":"段落スタイル: スタイルの箇条書きをテキストに変換","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1714},
{"name":"段落スタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1715},
{"name":"段落スタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1716},
{"name":"段落スタイル: スタイルを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1717},
{"name":"段落スタイル: スタイルを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1718},
{"name":"段落スタイル: スタイルを自動設定","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1719},
{"name":"段落スタイル: スタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1720},
{"name":"段落スタイル: スタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1721},
{"name":"段落スタイル: スタイル再定義","area":"パネルメニュー","shortcutText":"テキスト: Opt+Shift+Cmd+R","defined":true,"actionId":8458,"actionIdExpression":"0x2100 + 10","internalName":"KBSCE Palette Menus: Paragraph Styles: :Redefine Style","aliases":["スタイル再定義","KBSCE Palette Menus: Paragraph Styles: :Redefine Style"],"executable":true,"source":"GYAHTEI.txt","id":1722},
{"name":"段落スタイル: 名前順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1723},
{"name":"段落スタイル: 新しいスタイルパック","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1724},
{"name":"段落スタイル: 新規スタイルグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1725},
{"name":"段落スタイル: 新規段落スタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1726},
{"name":"段落スタイル: 段落スタイルの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1727},
{"name":"段落スタイル: 段落スタイルの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1728},
{"name":"注釈: 注釈アンカーへ移動","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1729},
{"name":"注釈: 注釈情報を表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1730},
{"name":"相互参照: 相互参照を再リンク...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1731},
{"name":"相互参照: 相互参照を削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1732},
{"name":"相互参照: 相互参照を挿入...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1733},
{"name":"相互参照: 相互参照を更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1734},
{"name":"相互参照: 相互参照オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1735},
{"name":"索引: 「検索」フィールドを表示","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1736},
{"name":"索引: オプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1737},
{"name":"索引: ソートオプション...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1738},
{"name":"索引: プレビューを更新","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1739},
{"name":"索引: 削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1740},
{"name":"索引: 新規索引項目...","area":"パネルメニュー","shortcutText":"デフォルト: Cmd+7","defined":true,"actionId":78082,"actionIdExpression":"0x13100 + 2","internalName":"KBSCE Palette Menus: Index: :NewReferenceMenu","aliases":["新規索引項目...","KBSCE Palette Menus: Index: :NewReferenceMenu"],"executable":true,"source":"GYAHTEI.txt","id":1741},
{"name":"索引: 新規索引項目の追加 (逆方向)","area":"パネルメニュー","shortcutText":"テキスト: Opt+Shift+Cmd+]","defined":true,"actionId":78099,"actionIdExpression":"0x13100 + 19","internalName":"KBSCE Palette Menus: Index: :Add new index entry (reversed)","aliases":["新規索引項目の追加 (逆方向)","KBSCE Palette Menus: Index: :Add new index entry (reversed)"],"executable":true,"source":"GYAHTEI.txt","id":1742},
{"name":"索引: 新規索引項目を追加","area":"パネルメニュー","shortcutText":"テキスト: Opt+Shift+Cmd+[","defined":true,"actionId":78098,"actionIdExpression":"0x13100 + 18","internalName":"KBSCE Palette Menus: Index: :Add new index entry","aliases":["新規索引項目を追加","KBSCE Palette Menus: Index: :Add new index entry"],"executable":true,"source":"GYAHTEI.txt","id":1743},
{"name":"索引: 新規見出しの追加","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1744},
{"name":"索引: 未使用の見出しを削除","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1745},
{"name":"索引: 未使用の見出しを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1746},
{"name":"索引: 索引の作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1747},
{"name":"索引: 複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1748},
{"name":"索引: 見出しの読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1749},
{"name":"索引: 選択したマーカへ","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1750},
{"name":"線: オプションを隠す","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1751},
{"name":"線: 線種...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1752},
{"name":"表スタイル: すべてのスタイルグループを閉じる","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1753},
{"name":"表スタイル: すべてのスタイルグループを開く","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1754},
{"name":"表スタイル: オーバーライドを消去","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1755},
{"name":"表スタイル: グループにコピー...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1756},
{"name":"表スタイル: スタイルからグループを作成...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1757},
{"name":"表スタイル: スタイルとのリンクを切断","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1758},
{"name":"表スタイル: スタイルの編集...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1759},
{"name":"表スタイル: スタイルを削除...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1760},
{"name":"表スタイル: スタイルを複製...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1761},
{"name":"表スタイル: スタイル再定義","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1762},
{"name":"表スタイル: 名前順","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1763},
{"name":"表スタイル: 新規スタイルグループ...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1764},
{"name":"表スタイル: 新規表スタイル...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1765},
{"name":"表スタイル: 表スタイルを読み込み...","area":"パネルメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1766},
{"name":"プラグインを参照","area":"プラグインメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1767},
{"name":"プラグインを管理","area":"プラグインメニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1768},
{"name":"JIS 04 字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1769},
{"name":"JIS 78 字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1770},
{"name":"JIS 83 字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1771},
{"name":"JIS 90 字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1772},
{"name":"N / Z 表示","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1773},
{"name":"ぶら下がり: なし","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1774},
{"name":"ぶら下がり: 強制","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1775},
{"name":"ぶら下がり: 標準","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1776},
{"name":"エキスパート字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1777},
{"name":"カスタム","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1778},
{"name":"グリッドのプリント・書き出し...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1779},
{"name":"グリッドの字間を基準に字送りを調整","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1780},
{"name":"グリッドフォーマットの適用","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+E","defined":true,"actionId":50182,"actionIdExpression":"0xc400 + 6","internalName":"KBSCE Japanese Typography:Apply Grid For&mat","aliases":["グリッドフォーマットの適用","KBSCE Japanese Typography:Apply Grid For&mat"],"executable":true,"source":"GYAHTEI.txt","id":1781},
{"name":"グリッドフォーマットを適用せずにペースト","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Shift+Cmd+V","defined":true,"actionId":50183,"actionIdExpression":"0xc400 + 7","internalName":"KBSCE Japanese Typography:Paste Without Grid F&ormat","aliases":["グリッドフォーマットを適用せずにペースト","KBSCE Japanese Typography:Paste Without Grid F&ormat"],"executable":true,"source":"GYAHTEI.txt","id":1782},
{"name":"グリッド揃え: なし","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1783},
{"name":"グリッド揃え: 仮想ボディの上","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1784},
{"name":"グリッド揃え: 仮想ボディの下","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1785},
{"name":"グリッド揃え: 仮想ボディの中央","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1786},
{"name":"グリッド揃え: 平均字面の上","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1787},
{"name":"グリッド揃え: 平均字面の下","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1788},
{"name":"グリッド揃え: 欧文ベースライン","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1789},
{"name":"ゴマ","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1790},
{"name":"テキストフレーム","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1791},
{"name":"パネル項目をすべて表示","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1792},
{"name":"フレームグリッド","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1793},
{"name":"フレームグリッド / テキストフレームの切り替え","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1794},
{"name":"フレームグリッドを表示","area":"日本語文字組版","shortcutText":"デフォルト: Shift+Cmd+E","defined":true,"actionId":50179,"actionIdExpression":"0xc400 + 3","internalName":"KBSCE Japanese Typography:S&how Frame Grid","aliases":["フレームグリッドを隠す","フレームグリッドを表示","KBSCE Japanese Typography:S&how Frame Grid"],"executable":true,"source":"GYAHTEI.txt","id":1795},
{"name":"フレームグリッド設定...","area":"日本語文字組版","shortcutText":"デフォルト: Cmd+B","defined":true,"actionId":50177,"actionIdExpression":"0xc400 + 1","internalName":"KBSCE Japanese Typography:&Frame Grid...","aliases":["フレームグリッド設定...","KBSCE Japanese Typography:&Frame Grid..."],"executable":true,"source":"GYAHTEI.txt","id":1796},
{"name":"プロポーショナルメトリクス","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1797},
{"name":"プロポーショナル字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1798},
{"name":"ルビ: なし","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1799},
{"name":"ルビが親文字より長い時の調整...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1800},
{"name":"ルビのフォントとサイズ...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1801},
{"name":"ルビの位置と間隔...","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+R","defined":true,"actionId":119738,"actionIdExpression":"0x1d300 + 186","internalName":"KBSCE Japanese Typography:Ruby...","aliases":["ルビの位置と間隔...","KBSCE Japanese Typography:Ruby..."],"executable":true,"source":"GYAHTEI.txt","id":1802},
{"name":"ルビカラー...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1803},
{"name":"レイアウトグリッドにスナップ","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Shift+Cmd+A","defined":true,"actionId":49923,"actionIdExpression":"0xc300 + 3","internalName":"KBSCE Japanese Typography:Snap to Page Grid","aliases":["レイアウトグリッドにスナップ","KBSCE Japanese Typography:Snap to Page Grid"],"executable":true,"source":"GYAHTEI.txt","id":1804},
{"name":"レイアウトグリッドを表示","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+A","defined":true,"actionId":49922,"actionIdExpression":"0xc300 + 2","internalName":"KBSCE Japanese Typography:Show Page Grid","aliases":["レイアウトグリッドを隠す","レイアウトグリッドを表示","KBSCE Japanese Typography:Show Page Grid"],"executable":true,"source":"GYAHTEI.txt","id":1805},
{"name":"レイアウトグリッド設定...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1806},
{"name":"三分前アキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1807},
{"name":"三分後ろアキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1808},
{"name":"中パネル","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1809},
{"name":"二分前アキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1810},
{"name":"二分四分前アキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1811},
{"name":"二分四分後ろアキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1812},
{"name":"二分後ろアキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1813},
{"name":"二重丸","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1814},
{"name":"仮想ボディの上 / 右","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1815},
{"name":"仮想ボディの下 / 左","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1816},
{"name":"仮想ボディの中央","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1817},
{"name":"全角前アキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1818},
{"name":"全角後ろアキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1819},
{"name":"八分前アキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1820},
{"name":"八分後ろアキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1821},
{"name":"前アキなし","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1822},
{"name":"前アキ自動挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1823},
{"name":"割注","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+W","defined":true,"actionId":119742,"actionIdExpression":"0x1d300 + 190","internalName":"KBSCE Japanese Typography:Warichu","aliases":["割注","KBSCE Japanese Typography:Warichu"],"executable":true,"source":"GYAHTEI.txt","id":1824},
{"name":"割注設定...","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+Z","defined":true,"actionId":26989,"actionIdExpression":"0x6900 + 109","internalName":"KBSCE Japanese Typography:Warichu Settings...","aliases":["割注設定...","KBSCE Japanese Typography:Warichu Settings..."],"executable":true,"source":"GYAHTEI.txt","id":1825},
{"name":"印刷標準字体","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1826},
{"name":"合成フォント...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1827},
{"name":"四分前アキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1828},
{"name":"四分後ろアキ挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1829},
{"name":"圏点: なし","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1830},
{"name":"圏点カラー...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1831},
{"name":"圏点設定...","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+K","defined":true,"actionId":119739,"actionIdExpression":"0x1d300 + 187","internalName":"KBSCE Japanese Typography:Kenten...","aliases":["圏点設定...","KBSCE Japanese Typography:Kenten..."],"executable":true,"source":"GYAHTEI.txt","id":1832},
{"name":"基本設定...","area":"日本語文字組版","shortcutText":"デフォルト: Shift+Cmd+X","defined":true,"actionId":49409,"actionIdExpression":"0xc100 + 1","internalName":"KBSCE Japanese Typography:MJKMI &Basic...","aliases":["基本設定...","KBSCE Japanese Typography:MJKMI &Basic..."],"executable":true,"source":"GYAHTEI.txt","id":1833},
{"name":"小さい白丸","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1834},
{"name":"小さい黒丸","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1835},
{"name":"小パネル","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1836},
{"name":"平均字面の上 / 右","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1837},
{"name":"平均字面の下 / 左","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1838},
{"name":"後ろアキなし","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1839},
{"name":"後ろアキ自動挿入","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1840},
{"name":"揃え表示","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1841},
{"name":"文字の比率を基準に行の高さを調整","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1842},
{"name":"文字数を表示","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+C","defined":true,"actionId":50178,"actionIdExpression":"0xc400 + 2","internalName":"KBSCE Japanese Typography:Hide Frame &Character Count","aliases":["文字数を隠す","文字数を表示","KBSCE Japanese Typography:Hide Frame &Character Count"],"executable":true,"source":"GYAHTEI.txt","id":1843},
{"name":"文字枠","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1844},
{"name":"文字枠と N / Z","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1845},
{"name":"文字組み基本設定...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1846},
{"name":"文字組み詳細設定...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1847},
{"name":"斜体...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1848},
{"name":"旧字体","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1849},
{"name":"標準字形に戻す","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1850},
{"name":"横または縦組み用かな","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1851},
{"name":"欧文イタリック","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1852},
{"name":"欧文ベースライン","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1853},
{"name":"白ゴマ","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1854},
{"name":"白三角","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1855},
{"name":"白丸","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1856},
{"name":"禁則処理セット...","area":"日本語文字組版","shortcutText":"デフォルト: Shift+Cmd+K","defined":true,"actionId":49665,"actionIdExpression":"0xc200 + 1","internalName":"KBSCE Japanese Typography:KNSKU Kinsoku Settings...","aliases":["禁則処理セット...","KBSCE Japanese Typography:KNSKU Kinsoku Settings..."],"executable":true,"source":"GYAHTEI.txt","id":1857},
{"name":"禁則設定...","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1858},
{"name":"等幅三分字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1859},
{"name":"等幅全角字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1860},
{"name":"等幅半角字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1861},
{"name":"等幅四分字形","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1862},
{"name":"縦中横","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Cmd+H","defined":true,"actionId":119741,"actionIdExpression":"0x1d300 + 189","internalName":"KBSCE Japanese Typography:Tate-chu-yoko","aliases":["縦中横","KBSCE Japanese Typography:Tate-chu-yoko"],"executable":true,"source":"GYAHTEI.txt","id":1863},
{"name":"縦中横設定...","area":"日本語文字組版","shortcutText":"デフォルト: Shift+Cmd+H","defined":true,"actionId":26905,"actionIdExpression":"0x6900 + 25","internalName":"KBSCE Japanese Typography:Tate-chu-yoko Settings...","aliases":["縦中横設定...","KBSCE Japanese Typography:Tate-chu-yoko Settings..."],"executable":true,"source":"GYAHTEI.txt","id":1864},
{"name":"自動縦中横","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1865},
{"name":"蛇の目","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1866},
{"name":"詳細設定...","area":"日本語文字組版","shortcutText":"デフォルト: Opt+Shift+Cmd+X","defined":true,"actionId":49410,"actionIdExpression":"0xc100 + 2","internalName":"KBSCE Japanese Typography:MJKMI &Detailed...","aliases":["詳細設定...","KBSCE Japanese Typography:MJKMI &Detailed..."],"executable":true,"source":"GYAHTEI.txt","id":1867},
{"name":"黒三角","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1868},
{"name":"黒丸","area":"日本語文字組版","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1869},
{"name":"XML 選択を上に拡張","area":"構造ナビゲーション","shortcutText":"XML 選択: Shift+上向き矢印","defined":true,"actionId":78657,"actionIdExpression":"0x13300 + 65","internalName":"KBSCE Structure navigation:Structure_AddPreviousNodeToSelection","aliases":["XML 選択を上に拡張","KBSCE Structure navigation:Structure_AddPreviousNodeToSelection"],"executable":true,"source":"GYAHTEI.txt","id":1870},
{"name":"XML 選択を上に移動","area":"構造ナビゲーション","shortcutText":"XML 選択: 上向き矢印","defined":true,"actionId":78655,"actionIdExpression":"0x13300 + 63","internalName":"KBSCE Structure navigation:Structure_MoveXMLSelectionToPreviousNode","aliases":["XML 選択を上に移動","KBSCE Structure navigation:Structure_MoveXMLSelectionToPreviousNode"],"executable":true,"source":"GYAHTEI.txt","id":1871},
{"name":"XML 選択を下に拡張","area":"構造ナビゲーション","shortcutText":"XML 選択: Shift+下向き矢印","defined":true,"actionId":78656,"actionIdExpression":"0x13300 + 64","internalName":"KBSCE Structure navigation:Structure_AddNextNodeToSelection","aliases":["XML 選択を下に拡張","KBSCE Structure navigation:Structure_AddNextNodeToSelection"],"executable":true,"source":"GYAHTEI.txt","id":1872},
{"name":"XML 選択を下に移動","area":"構造ナビゲーション","shortcutText":"XML 選択: 下向き矢印","defined":true,"actionId":78654,"actionIdExpression":"0x13300 + 62","internalName":"KBSCE Structure navigation:Structure_MoveXMLSelectionToNextNode","aliases":["XML 選択を下に移動","KBSCE Structure navigation:Structure_MoveXMLSelectionToNextNode"],"executable":true,"source":"GYAHTEI.txt","id":1873},
{"name":"先頭 XML ノードを選択","area":"構造ナビゲーション","shortcutText":"XML 選択: Home","defined":true,"actionId":78658,"actionIdExpression":"0x13300 + 66","internalName":"KBSCE Structure navigation:Structure_SelectFirstXMLNode","aliases":["先頭 XML ノードを選択","KBSCE Structure navigation:Structure_SelectFirstXMLNode"],"executable":true,"source":"GYAHTEI.txt","id":1874},
{"name":"前の検証エラーを表示","area":"構造ナビゲーション","shortcutText":"XML 選択: Cmd+左向き矢印","defined":true,"actionId":78673,"actionIdExpression":"0x13300 + 81","internalName":"KBSCE Structure navigation:Structure_ViewPreviousValidationError","aliases":["前の検証エラーを表示","KBSCE Structure navigation:Structure_ViewPreviousValidationError"],"executable":true,"source":"GYAHTEI.txt","id":1875},
{"name":"最初の XML ノードまで選択","area":"構造ナビゲーション","shortcutText":"XML 選択: Shift+Home","defined":true,"actionId":78667,"actionIdExpression":"0x13300 + 75","internalName":"KBSCE Structure navigation:Structure_SelectThroughFirstXMLNode","aliases":["最初の XML ノードまで選択","KBSCE Structure navigation:Structure_SelectThroughFirstXMLNode"],"executable":true,"source":"GYAHTEI.txt","id":1876},
{"name":"最後の XML ノードまで選択","area":"構造ナビゲーション","shortcutText":"XML 選択: Shift+End","defined":true,"actionId":78668,"actionIdExpression":"0x13300 + 76","internalName":"KBSCE Structure navigation:Structure_SelectThroughLastXMLNode","aliases":["最後の XML ノードまで選択","KBSCE Structure navigation:Structure_SelectThroughLastXMLNode"],"executable":true,"source":"GYAHTEI.txt","id":1877},
{"name":"最終 XML ノードを選択","area":"構造ナビゲーション","shortcutText":"XML 選択: End","defined":true,"actionId":78659,"actionIdExpression":"0x13300 + 67","internalName":"KBSCE Structure navigation:Structure_SelectLastXMLNode","aliases":["最終 XML ノードを選択","KBSCE Structure navigation:Structure_SelectLastXMLNode"],"executable":true,"source":"GYAHTEI.txt","id":1878},
{"name":"構造ウィンドウ枠を一画面上へスクロール","area":"構造ナビゲーション","shortcutText":"XML 選択: Page Up","defined":true,"actionId":78660,"actionIdExpression":"0x13300 + 68","internalName":"KBSCE Structure navigation:Structure_ScrollUp","aliases":["構造ウィンドウ枠を一画面上へスクロール","KBSCE Structure navigation:Structure_ScrollUp"],"executable":true,"source":"GYAHTEI.txt","id":1879},
{"name":"構造ウィンドウ枠を一画面下へスクロール","area":"構造ナビゲーション","shortcutText":"XML 選択: Page Down","defined":true,"actionId":78661,"actionIdExpression":"0x13300 + 69","internalName":"KBSCE Structure navigation:Structure_ScrollDown","aliases":["構造ウィンドウ枠を一画面下へスクロール","KBSCE Structure navigation:Structure_ScrollDown"],"executable":true,"source":"GYAHTEI.txt","id":1880},
{"name":"次の検証エラーを表示","area":"構造ナビゲーション","shortcutText":"XML 選択: Cmd+右向き矢印","defined":true,"actionId":78674,"actionIdExpression":"0x13300 + 82","internalName":"KBSCE Structure navigation:Structure_ViewNextValidationError","aliases":["次の検証エラーを表示","KBSCE Structure navigation:Structure_ViewNextValidationError"],"executable":true,"source":"GYAHTEI.txt","id":1881},
{"name":"要素と子の要素を折りたたみ","area":"構造ナビゲーション","shortcutText":"XML 選択: Opt+左向き矢印","defined":true,"actionId":78665,"actionIdExpression":"0x13300 + 73","internalName":"KBSCE Structure navigation:Structure_CollapseElementAndChildren","aliases":["要素と子の要素を折りたたみ","KBSCE Structure navigation:Structure_CollapseElementAndChildren"],"executable":true,"source":"GYAHTEI.txt","id":1882},
{"name":"要素と子の要素を拡大","area":"構造ナビゲーション","shortcutText":"XML 選択: Opt+右向き矢印","defined":true,"actionId":78664,"actionIdExpression":"0x13300 + 72","internalName":"KBSCE Structure navigation:Structure_ExpandElementAndChildren","aliases":["要素と子の要素を拡大","KBSCE Structure navigation:Structure_ExpandElementAndChildren"],"executable":true,"source":"GYAHTEI.txt","id":1883},
{"name":"要素を折りたたみ","area":"構造ナビゲーション","shortcutText":"XML 選択: 左向き矢印","defined":true,"actionId":78663,"actionIdExpression":"0x13300 + 71","internalName":"KBSCE Structure navigation:Structure_CollapseElement","aliases":["要素を折りたたみ","KBSCE Structure navigation:Structure_CollapseElement"],"executable":true,"source":"GYAHTEI.txt","id":1884},
{"name":"要素を拡大","area":"構造ナビゲーション","shortcutText":"XML 選択: 右向き矢印","defined":true,"actionId":78662,"actionIdExpression":"0x13300 + 70","internalName":"KBSCE Structure navigation:Structure_ExpandElement","aliases":["要素を拡大","KBSCE Structure navigation:Structure_ExpandElement"],"executable":true,"source":"GYAHTEI.txt","id":1885},
{"name":"XML を読み込み...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1886},
{"name":"アイテムへ","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1887},
{"name":"エラーリストを表示...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1888},
{"name":"コメントを隠す","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1889},
{"name":"スタイルをタグにマップ...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1890},
{"name":"タグの要素...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1891},
{"name":"タグをスタイルにマップ...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1892},
{"name":"タグ付きプリセットオプション...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1893},
{"name":"タグ付けされていないアイテムを追加","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1894},
{"name":"テキストの一部を表示","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1895},
{"name":"ルート要素から検証","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1896},
{"name":"処理命令を隠す","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1897},
{"name":"削除","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1898},
{"name":"属性を隠す","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1899},
{"name":"文書型定義を削除","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1900},
{"name":"文書型定義を表示...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1901},
{"name":"文書型定義を読み込み...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1902},
{"name":"文書型定義オプション...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1903},
{"name":"新規コメント...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1904},
{"name":"新規処理命令...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1905},
{"name":"新規属性...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1906},
{"name":"新規要素...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1907},
{"name":"新規親要素...","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1908},
{"name":"構造内で選択","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1909},
{"name":"編集","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1910},
{"name":"要素のタグを取り除く","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1911},
{"name":"選択要素から検証","area":"構造メニュー","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1912},
{"name":"1 画面上へスクロール","area":"表示、ナビゲーション","shortcutText":"デフォルト: Page Up, テキスト: Page Up","defined":true,"actionId":118816,"actionIdExpression":"0x1d000 + 32","internalName":"KBSCE Views, Navigation:Scroll up one Screen","aliases":["1 画面上へスクロール","KBSCE Views, Navigation:Scroll up one Screen"],"executable":true,"source":"GYAHTEI.txt","id":1913},
{"name":"1 画面下へスクロール","area":"表示、ナビゲーション","shortcutText":"デフォルト: Page Down, テキスト: Page Down","defined":true,"actionId":118815,"actionIdExpression":"0x1d000 + 31","internalName":"KBSCE Views, Navigation:Scroll down one Screen","aliases":["1 画面下へスクロール","KBSCE Views, Navigation:Scroll down one Screen"],"executable":true,"source":"GYAHTEI.txt","id":1914},
{"name":"1 番目の特色プレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+5","defined":true,"actionId":71961,"actionIdExpression":"0x11900 + 25","internalName":"KBSCE Views, Navigation:FlatPrvShow1stSpotPlate","aliases":["1 番目の特色プレートを表示","KBSCE Views, Navigation:FlatPrvShow1stSpotPlate"],"executable":true,"source":"GYAHTEI.txt","id":1915},
{"name":"2 番目の特色プレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+6","defined":true,"actionId":71962,"actionIdExpression":"0x11900 + 26","internalName":"KBSCE Views, Navigation:FlatPrvShow2ndSpotPlate","aliases":["2 番目の特色プレートを表示","KBSCE Views, Navigation:FlatPrvShow2ndSpotPlate"],"executable":true,"source":"GYAHTEI.txt","id":1916},
{"name":"200% サイズ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Cmd+2","defined":true,"actionId":118792,"actionIdExpression":"0x1d000 + 8","internalName":"KBSCE Views, Navigation:Zoom View to 200 Percent","aliases":["200% サイズ","KBSCE Views, Navigation:Zoom View to 200 Percent"],"executable":true,"source":"GYAHTEI.txt","id":1917},
{"name":"3 番目の特色プレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+7","defined":true,"actionId":71963,"actionIdExpression":"0x11900 + 27","internalName":"KBSCE Views, Navigation:FlatPrvShow3rdSpotPlate","aliases":["3 番目の特色プレートを表示","KBSCE Views, Navigation:FlatPrvShow3rdSpotPlate"],"executable":true,"source":"GYAHTEI.txt","id":1918},
{"name":"4 番目の特色プレートを表示","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1919},
{"name":"400% サイズ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Cmd+4","defined":true,"actionId":118793,"actionIdExpression":"0x1d000 + 9","internalName":"KBSCE Views, Navigation:Zoom View to 400 Percent","aliases":["400% サイズ","KBSCE Views, Navigation:Zoom View to 400 Percent"],"executable":true,"source":"GYAHTEI.txt","id":1920},
{"name":"5 番目の特色プレートを表示","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1921},
{"name":"50% サイズ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Cmd+5","defined":true,"actionId":118794,"actionIdExpression":"0x1d000 + 10","internalName":"KBSCE Views, Navigation:Zoom View to 50 Percent","aliases":["50% サイズ","KBSCE Views, Navigation:Zoom View to 50 Percent"],"executable":true,"source":"GYAHTEI.txt","id":1922},
{"name":"すべてのパネルを表示 / 隠す","area":"表示、ナビゲーション","shortcutText":"デフォルト: Tab","defined":true,"actionId":67383,"actionIdExpression":"0x10700 + 55","internalName":"KBSCE Views, Navigation:Show/Hide all palettes","aliases":["すべてのパネルを表示 / 隠す","KBSCE Views, Navigation:Show/Hide all palettes"],"executable":true,"source":"GYAHTEI.txt","id":1923},
{"name":"すべてのプレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+`","defined":true,"actionId":71956,"actionIdExpression":"0x11900 + 20","internalName":"KBSCE Views, Navigation:FlatPrvShowAllPlates","aliases":["すべてのプレートを表示","KBSCE Views, Navigation:FlatPrvShowAllPlates"],"executable":true,"source":"GYAHTEI.txt","id":1924},
{"name":"すべてを保存","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+S","defined":true,"actionId":326,"actionIdExpression":"0x100 + 70","internalName":"KBSCE Views, Navigation:Save all","aliases":["すべてを保存","KBSCE Views, Navigation:Save all"],"executable":true,"source":"GYAHTEI.txt","id":1925},
{"name":"すべて閉じる","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+W","defined":true,"actionId":325,"actionIdExpression":"0x100 + 69","internalName":"KBSCE Views, Navigation:Close all","aliases":["すべて閉じる","KBSCE Views, Navigation:Close all"],"executable":true,"source":"GYAHTEI.txt","id":1926},
{"name":"イエロープレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+3","defined":true,"actionId":71959,"actionIdExpression":"0x11900 + 23","internalName":"KBSCE Views, Navigation:FlatPrvShowYellowPlate","aliases":["イエロープレートを表示","KBSCE Views, Navigation:FlatPrvShowYellowPlate"],"executable":true,"source":"GYAHTEI.txt","id":1927},
{"name":"オブジェクト全体を表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+=","defined":true,"actionId":118790,"actionIdExpression":"0x1d000 + 6","internalName":"KBSCE Views, Navigation:Fit Selection in Window","aliases":["オブジェクト全体を表示","KBSCE Views, Navigation:Fit Selection in Window"],"executable":true,"source":"GYAHTEI.txt","id":1928},
{"name":"オーバーライドを圧縮 (最適化表示)","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1929},
{"name":"コンテキストメニューを開く","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1930},
{"name":"コントロールパネルでキーボードフォーカスを切り替え","area":"表示、ナビゲーション","shortcutText":"デフォルト: Cmd+6","defined":true,"actionId":70914,"actionIdExpression":"0x11500 + 2","internalName":"KBSCE Views, Navigation:SetControlPanelFocus","aliases":["コントロールパネルでキーボードフォーカスを切り替え","KBSCE Views, Navigation:SetControlPanelFocus"],"executable":true,"source":"GYAHTEI.txt","id":1931},
{"name":"コントロールパネル内での文字と段落モード切り替え","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+7","defined":true,"actionId":70915,"actionIdExpression":"0x11500 + 3","internalName":"KBSCE Views, Navigation:ToggleControlPanelTextMode","aliases":["コントロールパネル内での文字と段落モード切り替え","KBSCE Views, Navigation:ToggleControlPanelTextMode"],"executable":true,"source":"GYAHTEI.txt","id":1932},
{"name":"サイドタブですべてのパネルを開く / 閉じる","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+Tab","defined":true,"actionId":91226,"actionIdExpression":"0x16400 + 90","internalName":"KBSCE Views, Navigation:Open/Close all Stashed Palettes","aliases":["サイドタブですべてのパネルを開く / 閉じる","KBSCE Views, Navigation:Open/Close all Stashed Palettes"],"executable":true,"source":"GYAHTEI.txt","id":1933},
{"name":"シアンプレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+1","defined":true,"actionId":71957,"actionIdExpression":"0x11900 + 21","internalName":"KBSCE Views, Navigation:FlatPrvShowCyanPlate","aliases":["シアンプレートを表示","KBSCE Views, Navigation:FlatPrvShowCyanPlate"],"executable":true,"source":"GYAHTEI.txt","id":1934},
{"name":"スプレッド単位の定規","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1935},
{"name":"スレッド内の先頭のフレームへ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+Page Up","defined":true,"actionId":119631,"actionIdExpression":"0x1d300 + 79","internalName":"KBSCE Views, Navigation:Go to first frame","aliases":["スレッド内の先頭のフレームへ","KBSCE Views, Navigation:Go to first frame"],"executable":true,"source":"GYAHTEI.txt","id":1936},
{"name":"スレッド内の前のフレームへ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+Page Up","defined":true,"actionId":119630,"actionIdExpression":"0x1d300 + 78","internalName":"KBSCE Views, Navigation:Go to previous frame","aliases":["スレッド内の前のフレームへ","KBSCE Views, Navigation:Go to previous frame"],"executable":true,"source":"GYAHTEI.txt","id":1937},
{"name":"スレッド内の最後のフレームへ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+Page Down","defined":true,"actionId":119632,"actionIdExpression":"0x1d300 + 80","internalName":"KBSCE Views, Navigation:Go to last frame","aliases":["スレッド内の最後のフレームへ","KBSCE Views, Navigation:Go to last frame"],"executable":true,"source":"GYAHTEI.txt","id":1938},
{"name":"スレッド内の次のフレームへ","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+Page Down","defined":true,"actionId":119629,"actionIdExpression":"0x1d300 + 77","internalName":"KBSCE Views, Navigation:Go to next frame","aliases":["スレッド内の次のフレームへ","KBSCE Views, Navigation:Go to next frame"],"executable":true,"source":"GYAHTEI.txt","id":1939},
{"name":"ズーム % ボックスにアクセス","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+5","defined":true,"actionId":118808,"actionIdExpression":"0x1d000 + 24","internalName":"KBSCE Views, Navigation:Set Focus to Scale Editbox","aliases":["ズーム % ボックスにアクセス","KBSCE Views, Navigation:Set Focus to Scale Editbox"],"executable":true,"source":"GYAHTEI.txt","id":1940},
{"name":"ツールボックス以外のすべてのパネルを表示 / 非表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Shift+Tab","defined":true,"actionId":67384,"actionIdExpression":"0x10700 + 56","internalName":"KBSCE Views, Navigation:Show/Hide all palettes except toolbox","aliases":["ツールボックス以外のすべてのパネルを表示 / 非表示","KBSCE Views, Navigation:Show/Hide all palettes except toolbox"],"executable":true,"source":"GYAHTEI.txt","id":1941},
{"name":"ドキュメントを閉じる","area":"表示、ナビゲーション","shortcutText":"デフォルト: Shift+Cmd+W","defined":true,"actionId":327,"actionIdExpression":"0x100 + 71","internalName":"KBSCE Views, Navigation:Close document","aliases":["ドキュメントを閉じる","KBSCE Views, Navigation:Close document"],"executable":true,"source":"GYAHTEI.txt","id":1942},
{"name":"パネル内で最後に使用したフィールドをアクティブにする","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+`","defined":true,"actionId":324,"actionIdExpression":"0x100 + 68","internalName":"KBSCE Views, Navigation:Put the text caret in the last used edit field","aliases":["パネル内で最後に使用したフィールドをアクティブにする","KBSCE Views, Navigation:Put the text caret in the last used edit field"],"executable":true,"source":"GYAHTEI.txt","id":1943},
{"name":"ブラックプレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+4","defined":true,"actionId":71960,"actionIdExpression":"0x11900 + 24","internalName":"KBSCE Views, Navigation:FlatPrvShowBlackPlate","aliases":["ブラックプレートを表示","KBSCE Views, Navigation:FlatPrvShowBlackPlate"],"executable":true,"source":"GYAHTEI.txt","id":1944},
{"name":"ページ単位の定規","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1945},
{"name":"ページ番号ボックスにアクセス","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1946},
{"name":"マゼンタプレートを表示","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+2","defined":true,"actionId":71958,"actionIdExpression":"0x11900 + 22","internalName":"KBSCE Views, Navigation:FlatPrvShowMagentaPlate","aliases":["マゼンタプレートを表示","KBSCE Views, Navigation:FlatPrvShowMagentaPlate"],"executable":true,"source":"GYAHTEI.txt","id":1947},
{"name":"先頭スプレッド","area":"表示、ナビゲーション","shortcutText":"デフォルト: Home, デフォルト: Opt+Shift+Page Up, プレゼンテーションモード: Home","defined":true,"actionId":118819,"actionIdExpression":"0x1d000 + 35","internalName":"KBSCE Views, Navigation:First Spread","aliases":["先頭スプレッド","KBSCE Views, Navigation:First Spread"],"executable":true,"source":"GYAHTEI.txt","id":1948},
{"name":"前のウィンドウ","area":"表示、ナビゲーション","shortcutText":"プレゼンテーションモード: Shift+Cmd+Tab, プレゼンテーションモード: Shift+Cmd+`","defined":true,"actionId":330,"actionIdExpression":"0x100 + 74","internalName":"KBSCE Views, Navigation:Previous window","aliases":["前のウィンドウ","KBSCE Views, Navigation:Previous window"],"executable":true,"source":"GYAHTEI.txt","id":1949},
{"name":"単位システムをトグル","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Shift+Cmd+U","defined":true,"actionId":13368,"actionIdExpression":"0x3400 + 56","internalName":"KBSCE Views, Navigation:Toggle Measurement System","aliases":["単位システムをトグル","KBSCE Views, Navigation:Toggle Measurement System"],"executable":true,"source":"GYAHTEI.txt","id":1950},
{"name":"原点固定","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1951},
{"name":"右のサイドタブでパネルを開く / 閉じる","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1952},
{"name":"垂直定規: U","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1953},
{"name":"垂直定規: アゲート","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1954},
{"name":"垂直定規: アメリカ式ポイント","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1955},
{"name":"垂直定規: インチ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1956},
{"name":"垂直定規: カスタム...","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1957},
{"name":"垂直定規: シセロ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1958},
{"name":"垂直定規: センチメートル","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1959},
{"name":"垂直定規: デシマルインチ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1960},
{"name":"垂直定規: パイカ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1961},
{"name":"垂直定規: ピクセル","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1962},
{"name":"垂直定規: ポイント","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1963},
{"name":"垂直定規: ミリメートル","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1964},
{"name":"垂直定規: ミルス","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1965},
{"name":"垂直定規: 倍","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1966},
{"name":"垂直定規: 歯","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1967},
{"name":"定規をノド元から開始する","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1968},
{"name":"左のサイドタブでパネルを開く / 閉じる","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1969},
{"name":"強制再描画","area":"表示、ナビゲーション","shortcutText":"デフォルト: Shift+F5","defined":true,"actionId":318,"actionIdExpression":"0x100 + 62","internalName":"KBSCE Views, Navigation:Force Redraw","aliases":["強制再描画","KBSCE Views, Navigation:Force Redraw"],"executable":true,"source":"GYAHTEI.txt","id":1970},
{"name":"新規デフォルトドキュメント","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+N","defined":true,"actionId":319,"actionIdExpression":"0x100 + 63","internalName":"KBSCE Views, Navigation:New default document","aliases":["新規デフォルトドキュメント","KBSCE Views, Navigation:New default document"],"executable":true,"source":"GYAHTEI.txt","id":1971},
{"name":"最終スプレッド","area":"表示、ナビゲーション","shortcutText":"デフォルト: End, デフォルト: Opt+Shift+Page Down, プレゼンテーションモード: End","defined":true,"actionId":118820,"actionIdExpression":"0x1d000 + 36","internalName":"KBSCE Views, Navigation:Last Spread","aliases":["最終スプレッド","KBSCE Views, Navigation:Last Spread"],"executable":true,"source":"GYAHTEI.txt","id":1972},
{"name":"次のウィンドウ","area":"表示、ナビゲーション","shortcutText":"プレゼンテーションモード: Cmd+Tab, プレゼンテーションモード: Cmd+`","defined":true,"actionId":329,"actionIdExpression":"0x100 + 73","internalName":"KBSCE Views, Navigation:Next window","aliases":["次のウィンドウ","KBSCE Views, Navigation:Next window"],"executable":true,"source":"GYAHTEI.txt","id":1973},
{"name":"水平定規: U","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1974},
{"name":"水平定規: アゲート","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1975},
{"name":"水平定規: アメリカ式ポイント","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1976},
{"name":"水平定規: インチ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1977},
{"name":"水平定規: カスタム...","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1978},
{"name":"水平定規: シセロ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1979},
{"name":"水平定規: センチメートル","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1980},
{"name":"水平定規: デシマルインチ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1981},
{"name":"水平定規: パイカ","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1982},
{"name":"水平定規: ピクセル","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1983},
{"name":"水平定規: ポイント","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1984},
{"name":"水平定規: ミリメートル","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1985},
{"name":"水平定規: ミルス","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1986},
{"name":"水平定規: 倍","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1987},
{"name":"水平定規: 歯","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1988},
{"name":"現在のビューと前のビューを切り替える","area":"表示、ナビゲーション","shortcutText":"デフォルト: Opt+Cmd+2","defined":true,"actionId":118806,"actionIdExpression":"0x1d000 + 22","internalName":"KBSCE Views, Navigation:Toggle Between the Last Two View Percentages","aliases":["現在のビューと前のビューを切り替える","KBSCE Views, Navigation:Toggle Between the Last Two View Percentages"],"executable":true,"source":"GYAHTEI.txt","id":1989},
{"name":"背面にガイドを表示","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1990},
{"name":"背面にグリッドを表示","area":"表示、ナビゲーション","shortcutText":"[定義なし]","defined":false,"actionId":null,"actionIdExpression":"","internalName":"","aliases":[],"executable":false,"source":"GYAHTEI.txt","id":1991},
{"name":"終了","area":"アプリケーションメニュー","shortcutText":"デフォルト: Cmd+Q","defined":true,"actionId":267,"actionIdExpression":"0x100 + 11","internalName":"KBSCE File menu:Quit","aliases":["終了","KBSCE File menu:Quit"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1992},
{"name":"ダイアログパネル 1 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+1","defined":true,"actionId":1542,"actionIdExpression":"0x600 + 6","internalName":"KBSCE Alerts:Show dialog panel 1","aliases":["ダイアログパネル 1 を表示","KBSCE Alerts:Show dialog panel 1"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1993},
{"name":"ダイアログパネル 2 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+2","defined":true,"actionId":1543,"actionIdExpression":"0x600 + 7","internalName":"KBSCE Alerts:Show dialog panel 2","aliases":["ダイアログパネル 2 を表示","KBSCE Alerts:Show dialog panel 2"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1994},
{"name":"ダイアログパネル 3 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+3","defined":true,"actionId":1544,"actionIdExpression":"0x600 + 8","internalName":"KBSCE Alerts:Show dialog panel 3","aliases":["ダイアログパネル 3 を表示","KBSCE Alerts:Show dialog panel 3"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1995},
{"name":"ダイアログパネル 4 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+4","defined":true,"actionId":1545,"actionIdExpression":"0x600 + 9","internalName":"KBSCE Alerts:Show dialog panel 4","aliases":["ダイアログパネル 4 を表示","KBSCE Alerts:Show dialog panel 4"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1996},
{"name":"ダイアログパネル 5 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+5","defined":true,"actionId":1546,"actionIdExpression":"0x600 + 10","internalName":"KBSCE Alerts:Show dialog panel 5","aliases":["ダイアログパネル 5 を表示","KBSCE Alerts:Show dialog panel 5"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1997},
{"name":"ダイアログパネル 6 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+6","defined":true,"actionId":1547,"actionIdExpression":"0x600 + 11","internalName":"KBSCE Alerts:Show dialog panel 6","aliases":["ダイアログパネル 6 を表示","KBSCE Alerts:Show dialog panel 6"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1998},
{"name":"ダイアログパネル 7 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+7","defined":true,"actionId":1548,"actionIdExpression":"0x600 + 12","internalName":"KBSCE Alerts:Show dialog panel 7","aliases":["ダイアログパネル 7 を表示","KBSCE Alerts:Show dialog panel 7"],"executable":true,"source":"GYAHTEI.indk/runtime","id":1999},
{"name":"ダイアログパネル 8 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+8","defined":true,"actionId":1549,"actionIdExpression":"0x600 + 13","internalName":"KBSCE Alerts:Show dialog panel 8","aliases":["ダイアログパネル 8 を表示","KBSCE Alerts:Show dialog panel 8"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2000},
{"name":"ダイアログパネル 9 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+9","defined":true,"actionId":1550,"actionIdExpression":"0x600 + 14","internalName":"KBSCE Alerts:Show dialog panel 9","aliases":["ダイアログパネル 9 を表示","KBSCE Alerts:Show dialog panel 9"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2001},
{"name":"ダイアログパネル 10 を表示","area":"ダイアログ","shortcutText":"ダイアログ: Cmd+0","defined":true,"actionId":1551,"actionIdExpression":"0x600 + 15","internalName":"KBSCE Alerts:Show dialog panel 10","aliases":["ダイアログパネル 10 を表示","KBSCE Alerts:Show dialog panel 10"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2002},
{"name":"前のダイアログパネルを表示","area":"ダイアログ","shortcutText":"ダイアログ: Page Up, ダイアログ: Cmd+上向き矢印","defined":true,"actionId":1552,"actionIdExpression":"0x600 + 16","internalName":"KBSCE Alerts:Show previous dialog panel","aliases":["前のダイアログパネルを表示","KBSCE Alerts:Show previous dialog panel"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2003},
{"name":"次のダイアログパネルを表示","area":"ダイアログ","shortcutText":"ダイアログ: Page Down, ダイアログ: Cmd+下向き矢印","defined":true,"actionId":1553,"actionIdExpression":"0x600 + 17","internalName":"KBSCE Alerts:Show next dialog panel","aliases":["次のダイアログパネルを表示","KBSCE Alerts:Show next dialog panel"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2004},
{"name":"1 番目のダイアログパネルを表示","area":"ダイアログ","shortcutText":"ダイアログ: Home","defined":true,"actionId":1554,"actionIdExpression":"0x600 + 18","internalName":"KBSCE Alerts:Show first dialog panel","aliases":["1 番目のダイアログパネルを表示","KBSCE Alerts:Show first dialog panel"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2005},
{"name":"最後のダイアログパネルを表示","area":"ダイアログ","shortcutText":"ダイアログ: End","defined":true,"actionId":1555,"actionIdExpression":"0x600 + 19","internalName":"KBSCE Alerts:Show last dialog panel","aliases":["最後のダイアログパネルを表示","KBSCE Alerts:Show last dialog panel"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2006},
{"name":"親のフレーム","area":"オブジェクト編集","shortcutText":"デフォルト: Escape","defined":true,"actionId":11351,"actionIdExpression":"0x2c00 + 87","internalName":"KBSCE Object menu: Select: :Select Container","aliases":["親のフレーム","KBSCE Object menu: Select: :Select Container"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2007},
{"name":"コンテンツ","area":"オブジェクト編集","shortcutText":"デフォルト: Shift+Escape","defined":true,"actionId":11352,"actionIdExpression":"0x2c00 + 88","internalName":"KBSCE Object menu: Select: :Select Content","aliases":["コンテンツ","KBSCE Object menu: Select: :Select Content"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2008},
{"name":"InDesign ヘルプ...","area":"ヘルプメニュー","shortcutText":"デフォルト: Help","defined":true,"actionId":38657,"actionIdExpression":"0x9700 + 1","internalName":"KBSCE Help menu:InDesign Help...","aliases":["InDesign ヘルプ...","KBSCE Help menu:InDesign Help..."],"executable":true,"source":"GYAHTEI.indk/runtime","id":2009},
{"name":"セル / テキストの選択へトグル","area":"テキストと表","shortcutText":"表: Escape","defined":true,"actionId":66855,"actionIdExpression":"0x10500 + 39","internalName":"KBSCE Text and Tables:Switch From Cell Selection to Text Selection","aliases":["セル / テキストの選択へトグル","KBSCE Text and Tables:Switch From Cell Selection to Text Selection"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2010},
{"name":"オブジェクトを終了","area":"テキストと表","shortcutText":"テーブルオブジェクトコンテキスト: Escape","defined":true,"actionId":66924,"actionIdExpression":"0x10500 + 108","internalName":"KBSCE Text and Tables:Object Escape","aliases":["オブジェクトを終了","KBSCE Text and Tables:Object Escape"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2011},
{"name":"選択ツールとダイレクト選択ツールを切り替える","area":"ツール","shortcutText":"デフォルト: Cmd+Tab, デフォルト: Ctrl+Tab, デフォルト: Ctrl+Cmd+Tab","defined":true,"actionId":118821,"actionIdExpression":"0x1d000 + 37","internalName":"KBSCE Tools:Toggle between Select and Direct Select tool","aliases":["選択ツールとダイレクト選択ツールを切り替える","KBSCE Tools:Toggle between Select and Direct Select tool"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2012},
{"name":"テキストスタイルの適用","area":"テキストと表","shortcutText":"デフォルト: Cmd+Num 0, デフォルト: Shift+Num 0, デフォルト: Shift+Cmd+Num 0, デフォルト: Opt+Num 0, デフォルト: Opt+Cmd+Num 0, デフォルト: Opt+Shift+Num 0, デフォルト: Opt+Shift+Cmd+Num 0, デフォルト: Cmd+Num 1, デフォルト: Shift+Num 1, デフォルト: Shift+Cmd+Num 1, デフォルト: Opt+Num 1, デフォルト: Opt+Cmd+Num 1, デフォルト: Opt+Shift+Num 1, デフォルト: Opt+Shift+Cmd+Num 1, デフォルト: Cmd+Num 2, デフォルト: Shift+Num 2, デフォルト: Shift+Cmd+Num 2, デフォルト: Opt+Num 2, デフォルト: Opt+Cmd+Num 2, デフォルト: Opt+Shift+Num 2, デフォルト: Opt+Shift+Cmd+Num 2, デフォルト: Cmd+Num 3, デフォルト: Shift+Num 3, デフォルト: Shift+Cmd+Num 3, デフォルト: Opt+Num 3, デフォルト: Opt+Cmd+Num 3, デフォルト: Opt+Shift+Num 3, デフォルト: Opt+Shift+Cmd+Num 3, デフォルト: Cmd+Num 4, デフォルト: Shift+Num 4, デフォルト: Shift+Cmd+Num 4, デフォルト: Opt+Num 4, デフォルト: Opt+Cmd+Num 4, デフォルト: Opt+Shift+Num 4, デフォルト: Opt+Shift+Cmd+Num 4, デフォルト: Cmd+Num 5, デフォルト: Shift+Num 5, デフォルト: Shift+Cmd+Num 5, デフォルト: Opt+Num 5, デフォルト: Opt+Cmd+Num 5, デフォルト: Opt+Shift+Num 5, デフォルト: Opt+Shift+Cmd+Num 5, デフォルト: Cmd+Num 6, デフォルト: Shift+Num 6, デフォルト: Shift+Cmd+Num 6, デフォルト: Opt+Num 6, デフォルト: Opt+Cmd+Num 6, デフォルト: Opt+Shift+Num 6, デフォルト: Opt+Shift+Cmd+Num 6, デフォルト: Cmd+Num 7, デフォルト: Shift+Num 7, デフォルト: Shift+Cmd+Num 7, デフォルト: Opt+Num 7, デフォルト: Opt+Cmd+Num 7, デフォルト: Opt+Shift+Num 7, デフォルト: Opt+Shift+Cmd+Num 7, デフォルト: Cmd+Num 8, デフォルト: Shift+Num 8, デフォルト: Shift+Cmd+Num 8, デフォルト: Opt+Num 8, デフォルト: Opt+Cmd+Num 8, デフォルト: Opt+Shift+Num 8, デフォルト: Opt+Shift+Cmd+Num 8, デフォルト: Cmd+Num 9, デフォルト: Shift+Num 9, デフォルト: Shift+Cmd+Num 9, デフォルト: Opt+Num 9, デフォルト: Opt+Cmd+Num 9, デフォルト: Opt+Shift+Num 9, デフォルト: Opt+Shift+Cmd+Num 9","defined":true,"actionId":119628,"actionIdExpression":"0x1d300 + 76","internalName":"KBSCE Text and Tables:Apply text style","aliases":["テキストスタイルの適用","KBSCE Text and Tables:Apply text style"],"executable":true,"source":"GYAHTEI.indk/runtime","id":2013}];

(function () {
    var SS_VERSION = "1.0.10";
    var MAX_RESULTS = 300;
    var commands = [];
    var selectedCommand = null;
    var currentSet = null;
    var currentScriptCatalog = [];

    var contextLabels = {
        DefaultContext: "デフォルト",
        TextContext: "テキスト",
        TableContext: "表",
        TableObjectContext: "テーブルオブジェクト",
        DialogContext: "ダイアログ",
        FullScreenContext: "プレゼンテーションモード",
        KBSCContext_XMLStructureContext: "XML 選択"
    };

    var contextValues = [
        "DefaultContext", "TextContext", "TableContext", "TableObjectContext",
        "DialogContext", "FullScreenContext", "KBSCContext_XMLStructureContext"
    ];

    var standardFeatureAreas = [
        "アプリケーションメニュー", "ファイルメニュー", "編集メニュー",
        "レイアウトメニュー", "書式メニュー", "オブジェクトメニュー",
        "表メニュー", "表示メニュー", "KBSCE Window menu", "ウィンドウメニュー",
        "ヘルプメニュー", null, "Panel Menus", "オブジェクト編集", "スクリプト",
        "ツール", "テキストと表", "パネルメニュー", "プラグインメニュー",
        "日本語文字組版", "構造ナビゲーション", "構造メニュー", "表示、ナビゲーション"
    ];

    function parseResult(raw) {
        try {
            return eval("(" + String(raw || "") + ")");
        } catch (error) {
            return {ok: false, message: String(raw || "InDesignから応答がありません")};
        }
    }

    function trim(value) {
        return String(value || "").replace(/^\s+|\s+$/g, "");
    }

    function normalize(value) {
        return String(value || "").toLowerCase().replace(/[\s　]+/g, "");
    }

    function actionIdKey(value) {
        var number = Number(value);
        if (isNaN(number)) { return ""; }
        number = number % 4294967296;
        if (number < 0) { number += 4294967296; }
        return String(number);
    }

    function standardFeatureArea(value, fallback) {
        var area = String(value || "");
        var i;
        if (/^Apple メニュー(?::|$)/.test(area)) { return "アプリケーションメニュー"; }
        if (area === "ダイアログ") { return "表示、ナビゲーション"; }
        for (i = 0; i < standardFeatureAreas.length; i++) {
            if (standardFeatureAreas[i] &&
                    (area === standardFeatureAreas[i] ||
                    area.indexOf(standardFeatureAreas[i] + ":") === 0)) {
                return standardFeatureAreas[i];
            }
        }
        return fallback || "アプリケーションメニュー";
    }

    function displayShortcut(raw) {
        var replacements = {
            "#Keyboard_Return_Mac": "Return", "#Keyboard_Enter_Mac": "Enter",
            "#Keyboard_Delete_Mac": "Delete", "#Keyboard_Del_Mac": "Forward Delete",
            "#Keyboard_Up Arrow": "上向き矢印", "#Keyboard_Down Arrow": "下向き矢印",
            "#Keyboard_Left Arrow": "左向き矢印", "#Keyboard_Right Arrow": "右向き矢印",
            "#Keyboard_Page Up": "Page Up", "#Keyboard_Page Down": "Page Down",
            "#Keyboard_Space": "スペースバー", "#Keyboard_Escape": "Escape",
            "#Keyboard_Tab": "Tab", "#Keyboard_Home": "Home", "#Keyboard_End": "End"
        };
        var result = String(raw || "");
        var key;
        for (key in replacements) {
            if (replacements.hasOwnProperty(key)) {
                result = result.split(key).join(replacements[key]);
            }
        }
        return result.replace(/#Keyboard_/g, "");
    }

    function canonicalManualShortcut(value) {
        var parts = String(value || "").split("+");
        var result = [];
        var modifierMap = {
            ctrl: "Ctrl", control: "Ctrl", "⌃": "Ctrl",
            opt: "Opt", option: "Opt", alt: "Opt", "⌥": "Opt",
            shift: "Shift", "⇧": "Shift",
            cmd: "Cmd", command: "Cmd", meta: "Cmd", "⌘": "Cmd"
        };
        var namedKeyMap = {
            "return": "#Keyboard_Return_Mac", enter: "#Keyboard_Enter_Mac",
            tab: "#Keyboard_Tab", escape: "#Keyboard_Escape", esc: "#Keyboard_Escape",
            space: "#Keyboard_Space", "スペースバー": "#Keyboard_Space",
            "delete": "#Keyboard_Delete_Mac", "forward delete": "#Keyboard_Del_Mac",
            home: "#Keyboard_Home", end: "#Keyboard_End",
            "page up": "#Keyboard_Page Up", "page down": "#Keyboard_Page Down",
            "上向き矢印": "#Keyboard_Up Arrow", "下向き矢印": "#Keyboard_Down Arrow",
            "左向き矢印": "#Keyboard_Left Arrow", "右向き矢印": "#Keyboard_Right Arrow"
        };
        var i;
        for (i = 0; i < parts.length; i++) {
            var part = trim(parts[i]);
            var lower = part.toLowerCase();
            if (!part) { continue; }
            if (modifierMap[lower]) {
                result.push(modifierMap[lower]);
            } else if (namedKeyMap[lower]) {
                result.push(namedKeyMap[lower]);
            } else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) {
                result.push("#Keyboard_" + part.toUpperCase());
            } else {
                result.push(part.length === 1 ? part.toUpperCase() : part);
            }
        }
        return gyahteiCanonicalShortcut(result.join("+"));
    }

    function copyCommand(source) {
        var copy = {};
        var key;
        for (key in source) {
            if (source.hasOwnProperty(key)) { copy[key] = source[key]; }
        }
        copy.assignments = [];
        copy.defined = false;
        copy.shortcutText = "[定義なし]";
        return copy;
    }

    function searchText(command) {
        return normalize([
            command.name, command.area, command.shortcutText,
            command.actionIdExpression, command.internalName,
            (command.aliases || []).join(" ")
        ].join(" "));
    }

    function rebuildCommands(records) {
        var byActionId = {};
        var byInternalName = {};
        var byCommandName = {};
        var i;
        var command;
        commands = [];
        for (i = 0; i < SHORTCUT_SEARCH_COMMANDS.length; i++) {
            /* スクリプト項目は古い固定一覧を使わず、現在のScriptsパネルから作る。 */
            if (SHORTCUT_SEARCH_COMMANDS[i].area === "スクリプト") { continue; }
            command = copyCommand(SHORTCUT_SEARCH_COMMANDS[i]);
            commands.push(command);
            if (command.actionId !== null && command.actionId !== undefined) {
                byActionId[actionIdKey(command.actionId)] = command;
            }
            byCommandName[normalize(command.name)] = command;
            if (command.internalName) { byInternalName[command.internalName] = command; }
        }
        for (i = 0; i < currentScriptCatalog.length; i++) {
            var liveScript = currentScriptCatalog[i];
            command = byCommandName[normalize(liveScript.name)];
            if (!command) {
                command = copyCommand(liveScript);
                commands.push(command);
                byCommandName[normalize(command.name)] = command;
            }
            if (!command.internalName) { command.internalName = liveScript.internalName; }
            if (command.internalName) { byInternalName[command.internalName] = command; }
            var liveAliases = liveScript.aliases || [];
            var lai;
            for (lai = 0; lai < liveAliases.length; lai++) {
                byCommandName[normalize(String(liveAliases[lai]).replace(/^スクリプト:/, ""))] = command;
            }
        }
        for (i = 0; i < records.length; i++) {
            var record = records[i];
            var idKey = record.actionId === null ? "" : actionIdKey(record.actionId);
            var scriptRecordName = String(record.internalName || "").replace(/^スクリプト:/, "");
            if (/^スクリプト:/.test(record.internalName)) {
                command = byInternalName[record.internalName] ||
                    byCommandName[normalize(scriptRecordName)] ||
                    (idKey ? byActionId[idKey] : null);
            } else {
                command = idKey ? byActionId[idKey] : null;
            }
            if (!command) {
                command = {
                    id: "live-" + i,
                    name: record.name || record.internalName || record.actionIdExpression,
                    area: standardFeatureArea(record.area, "アプリケーションメニュー"),
                    actionId: record.actionId,
                    actionIdExpression: record.actionIdExpression,
                    internalName: record.internalName,
                    aliases: [record.internalName],
                    executable: Boolean(record.name) && record.actionIdUnsigned < 4278190080,
                    source: "現在の.indk",
                    assignments: []
                };
                commands.push(command);
                if (idKey) { byActionId[idKey] = command; }
                if (record.internalName) { byInternalName[record.internalName] = command; }
                byCommandName[normalize(command.name)] = command;
            }
            if (!command.actionIdExpression) { command.actionIdExpression = record.actionIdExpression; }
            if (!command.internalName) { command.internalName = record.internalName; }
            if (record.name && (!command.name || command.name.indexOf("KBSCE ") === 0)) {
                command.name = record.name;
            }
            if (record.area && command.source === "現在の.indk") {
                command.area = standardFeatureArea(record.area, command.area);
            }
            command.assignments.push({
                context: record.context,
                shortcut: record.shortcut,
                actionIdExpression: record.actionIdExpression,
                internalName: record.internalName
            });
        }
        for (i = 0; i < commands.length; i++) {
            command = commands[i];
            command.defined = command.assignments.length > 0;
            if (command.defined) {
                var labels = [];
                var j;
                for (j = 0; j < command.assignments.length; j++) {
                    labels.push((contextLabels[command.assignments[j].context] ||
                        command.assignments[j].context) + ": " +
                        displayShortcut(command.assignments[j].shortcut));
                }
                command.shortcutText = labels.join(", ");
            }
            command._search = searchText(command);
        }
    }

    function resolutionCandidates(command) {
        var candidates = [command.name];
        var aliases = command.aliases || [];
        var i;
        for (i = 0; i < aliases.length; i++) { candidates.push(aliases[i]); }
        var colon = String(command.name || "").lastIndexOf(":");
        if (colon >= 0) { candidates.push(trim(command.name.slice(colon + 1))); }
        return candidates;
    }

    function fullScriptInternalName(command, resolvedName) {
        var commandName = gyahteiNormalizeScriptPathName(command && command.name || "");
        if (/^(ユーザー|アプリケーション):/.test(commandName)) {
            return "スクリプト:" + commandName;
        }
        var existing = gyahteiNormalizeScriptPathName(command && command.internalName || "");
        if (/^(ユーザー|アプリケーション):/.test(existing)) {
            return "スクリプト:" + existing;
        }
        return "スクリプト:" + gyahteiNormalizeScriptPathName(resolvedName || commandName);
    }

    function findShortcutUses(shortcut) {
        var uses = [];
        var i;
        var j;
        for (i = 0; i < commands.length; i++) {
            if (commands[i] === selectedCommand) { continue; }
            for (j = 0; j < commands[i].assignments.length; j++) {
                if (gyahteiCanonicalShortcut(commands[i].assignments[j].shortcut) ===
                        gyahteiCanonicalShortcut(shortcut)) {
                    uses.push({command: commands[i], context: commands[i].assignments[j].context});
                }
            }
        }
        return uses;
    }

    function settingsFile(createFolder) {
        var folder = new Folder(Folder.userData.fsName + "/ShortcutSearchJSX");
        if (!folder.exists && createFolder) {
            try { folder.create(); } catch (ignoreCreateSettings) {}
        }
        return new File(folder.fsName + "/settings.txt");
    }

    function loadSettings() {
        var settings = {width: 700, height: 820, definedOnly: false};
        try {
            var file = settingsFile(false);
            if (!file.exists) { return settings; }
            file.encoding = "UTF-8";
            if (!file.open("r")) { return settings; }
            var text = file.read();
            file.close();
            var lines = text.split(/\r?\n/);
            var i;
            for (i = 0; i < lines.length; i++) {
                var equal = lines[i].indexOf("=");
                if (equal < 0) { continue; }
                var key = trim(lines[i].slice(0, equal));
                var value = trim(lines[i].slice(equal + 1));
                if (key === "width" && !isNaN(Number(value))) { settings.width = Number(value); }
                else if (key === "height" && !isNaN(Number(value))) { settings.height = Number(value); }
                else if (key === "definedOnly") { settings.definedOnly = value === "true"; }
            }
        } catch (ignoreLoadSettings) {}
        settings.width = Math.max(520, Math.min(1600, settings.width));
        settings.height = Math.max(620, Math.min(1600, settings.height));
        return settings;
    }

    try {
        if ($.global.shortcutSearchWindow) {
            try { $.global.shortcutSearchWindow.close(); } catch (ignoreOldWindow) {}
            $.global.shortcutSearchWindow = null;
        }

        var savedSettings = loadSettings();
        var w = new Window("palette", "ショートカット検索", undefined, {resizeable: true});
        $.global.shortcutSearchWindow = w;
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 7;
        w.margins = 12;
        w.minimumSize = [520, 620];

        var titleGroup = w.add("group");
        titleGroup.alignment = ["fill", "top"];
        titleGroup.add("statictext", undefined, "ショートカット検索").graphics.font =
            ScriptUI.newFont("dialog", "BOLD", 15);
        var versionText = titleGroup.add("statictext", undefined, "InDesign " + app.version + " / JSX " + SS_VERSION);
        versionText.alignment = ["right", "center"];

        var setGroup = w.add("group");
        setGroup.alignment = ["fill", "top"];
        var setDropdown = setGroup.add("dropdownlist", undefined, []);
        setDropdown.alignment = ["fill", "center"];
        setDropdown.minimumSize.width = 280;
        var chooseButton = setGroup.add("button", undefined, "ファイル…");
        var reloadButton = setGroup.add("button", undefined, "再読込");

        var searchInput = w.add("edittext", undefined, "");
        searchInput.alignment = ["fill", "top"];
        searchInput.helpTip = "コマンド名・キー・機能エリアを検索";

        var filterGroup = w.add("group");
        filterGroup.alignment = ["fill", "top"];
        var areaDropdown = filterGroup.add("dropdownlist", undefined, []);
        areaDropdown.minimumSize.width = 245;
        areaDropdown.add("item", "すべての機能エリア")._value = "";
        var ai;
        for (ai = 0; ai < standardFeatureAreas.length; ai++) {
            var areaItem;
            if (standardFeatureAreas[ai] === null) {
                areaItem = areaDropdown.add("item", "──────────");
                areaItem.enabled = false;
                areaItem._value = "";
            } else {
                areaItem = areaDropdown.add("item", standardFeatureAreas[ai]);
                areaItem._value = standardFeatureAreas[ai];
            }
        }
        areaDropdown.selection = 0;
        var definedOnly = filterGroup.add("checkbox", undefined, "設定済みのみ");
        definedOnly.value = savedSettings.definedOnly;
        var executableOnly = filterGroup.add("checkbox", undefined, "実行可能のみ");

        var summaryText = w.add("statictext", undefined, "0件");
        var resultList = w.add("listbox", undefined, [], {
            numberOfColumns: 3,
            showHeaders: true,
            columnTitles: ["コマンド", "ショートカット", "機能エリア"],
            columnWidths: [290, 210, 145]
        });
        resultList.alignment = ["fill", "fill"];
        resultList.minimumSize.height = 190;
        resultList.preferredSize.height = 390;

        var detailPanel = w.add("panel", undefined, "選択中のコマンド");
        detailPanel.orientation = "column";
        detailPanel.alignChildren = ["fill", "top"];
        detailPanel.alignment = ["fill", "bottom"];
        detailPanel.margins = 10;
        var detailName = detailPanel.add("statictext", undefined, "コマンドを選択してください", {multiline: true});
        detailName.graphics.font = ScriptUI.newFont("dialog", "BOLD", 13);
        detailName.preferredSize.height = 24;
        var detailShortcut = detailPanel.add("statictext", undefined, "");
        detailShortcut.preferredSize.height = 18;
        var detailArea = detailPanel.add("statictext", undefined, "");
        detailArea.preferredSize.height = 18;
        var detailAction = detailPanel.add("statictext", undefined, "");
        detailAction.preferredSize.height = 18;

        var editorGroup = detailPanel.add("group");
        editorGroup.orientation = "column";
        editorGroup.alignChildren = ["fill", "top"];
        editorGroup.alignment = ["fill", "top"];
        editorGroup.spacing = 5;

        var currentGroup = editorGroup.add("group");
        currentGroup.add("statictext", undefined, "現在のショートカット:");
        var currentDropdown = currentGroup.add("dropdownlist", undefined, []);
        currentDropdown.alignment = ["fill", "center"];
        currentDropdown.minimumSize.width = 250;
        var deleteButton = currentGroup.add("button", undefined, "削除");

        var assignGroup = editorGroup.add("group");
        var contextDropdown = assignGroup.add("dropdownlist", undefined, []);
        var ci;
        for (ci = 0; ci < contextValues.length; ci++) {
            var contextItem = contextDropdown.add("item", contextLabels[contextValues[ci]]);
            contextItem._value = contextValues[ci];
        }
        contextDropdown.selection = 0;
        contextDropdown.minimumSize.width = 145;
        contextDropdown.helpTip = "ショートカットが有効になる適用範囲です。通常は「デフォルト」を使用します";
        var captureDisplay = assignGroup.add("edittext", undefined, "", {readonly: true});
        captureDisplay.alignment = ["fill", "center"];
        captureDisplay.helpTip = "ここをクリックしてキーを記録";
        var captureButton = assignGroup.add("button", undefined, "キーを記録…");

        var manualInput = editorGroup.add("edittext", undefined, "");
        manualInput.helpTip = "記録できない場合は Cmd+K のように直接入力";
        var conflictText = editorGroup.add("statictext", undefined, "", {multiline: true});
        conflictText.preferredSize.height = 0;
        conflictText.maximumSize.height = 0;
        conflictText.visible = false;

        var saveGroup = editorGroup.add("group");
        var setNameInput = saveGroup.add("edittext", undefined, "");
        setNameInput.alignment = ["fill", "center"];
        setNameInput.minimumSize.width = 255;
        var saveButton = saveGroup.add("button", undefined, "割り当てて保存");
        var editorNote = editorGroup.add("statictext", undefined, "", {multiline: true});
        editorNote.preferredSize.height = 28;

        var actionGroup = detailPanel.add("group");
        var invokeButton = actionGroup.add("button", undefined, "実行");
        var statusText = actionGroup.add("statictext", undefined, "", {multiline: true});
        statusText.alignment = ["fill", "center"];

        function setStatus(message) {
            statusText.text = String(message || "");
        }

        function saveSettings() {
            try {
                var file = settingsFile(true);
                file.encoding = "UTF-8";
                if (!file.open("w")) { return; }
                file.write("width=" + Math.round(w.size.width) + "\n" +
                    "height=" + Math.round(w.size.height) + "\n" +
                    "definedOnly=" + (definedOnly.value ? "true" : "false") + "\n");
                file.close();
            } catch (ignoreSaveSettings) {}
        }

        function selectedAreaValue() {
            return areaDropdown.selection ? areaDropdown.selection._value : "";
        }

        function clearSelection() {
            selectedCommand = null;
            resultList.selection = null;
            detailName.text = currentSet ? "コマンドを選択してください" : "ショートカットセットを選択してください";
            detailShortcut.text = "";
            detailArea.text = "";
            detailAction.text = "";
            editorGroup.visible = false;
            invokeButton.enabled = false;
            saveButton.enabled = false;
            deleteButton.enabled = false;
        }

        function commandSelectionKey(command) {
            if (!command) { return ""; }
            if (command.internalName) { return "internal:" + normalize(command.internalName); }
            if (command.actionId !== null && command.actionId !== undefined) {
                return "action:" + actionIdKey(command.actionId);
            }
            return "name:" + normalize(command.name);
        }

        function restoreCommandSelection(selectionKey) {
            if (!selectionKey) { return false; }
            var i;
            for (i = 0; i < resultList.items.length; i++) {
                var item = resultList.items[i];
                if (item._command && commandSelectionKey(item._command) === selectionKey) {
                    resultList.selection = item;
                    showSelectedCommand(item._command);
                    return true;
                }
            }
            return false;
        }

        function render() {
            var query = normalize(searchInput.text);
            var area = selectedAreaValue();
            resultList.removeAll();
            clearSelection();
            var count = 0;
            var rendered = 0;
            var i;
            for (i = 0; i < commands.length; i++) {
                var command = commands[i];
                if (definedOnly.value && !command.defined) { continue; }
                if (executableOnly.value && !command.executable) { continue; }
                if (area && command.area !== area) { continue; }
                if (query && command._search.indexOf(query) < 0) { continue; }
                count++;
                if (rendered >= MAX_RESULTS) { continue; }
                var item = resultList.add("item", command.name);
                item.subItems[0].text = command.shortcutText;
                item.subItems[1].text = command.area;
                item._command = command;
                rendered++;
            }
            summaryText.text = count + "件" + (count > rendered ? "（先頭" + rendered + "件を表示）" : "");
        }

        function updateSaveMode() {
            var overwrite = currentSet && (currentSet.kind === "ユーザー" || currentSet.kind === "パネル編集");
            setNameInput.enabled = !overwrite;
            setNameInput.text = overwrite ? currentSet.name : currentSet.name + " - カスタム";
            saveButton.text = overwrite ? "割り当てて上書き" : "別名で保存";
            editorNote.text = overwrite
                ? "ユーザーセット「" + currentSet.name + "」を上書きします。"
                : "プリセットは変更せず、新しいユーザーセットとして保存します。";
        }

        function updateCurrentAssignments() {
            currentDropdown.removeAll();
            if (!selectedCommand) {
                currentGroup.visible = false;
                return;
            }
            var i;
            for (i = 0; i < selectedCommand.assignments.length; i++) {
                var assignment = selectedCommand.assignments[i];
                var item = currentDropdown.add("item", (contextLabels[assignment.context] ||
                    assignment.context) + ": " + displayShortcut(assignment.shortcut));
                item._assignment = assignment;
            }
            currentGroup.visible = selectedCommand.assignments.length > 0;
            if (currentDropdown.items.length) { currentDropdown.selection = 0; }
            deleteButton.enabled = currentDropdown.items.length > 0;
        }

        function currentRawShortcut() {
            return captureDisplay._raw || canonicalManualShortcut(manualInput.text);
        }

        function updateConflictDisplay() {
            var shortcut = currentRawShortcut();
            if (!shortcut || !selectedCommand) {
                conflictText.text = "";
                conflictText.visible = false;
                conflictText.preferredSize.height = 0;
                conflictText.maximumSize.height = 0;
                saveButton.enabled = false;
                w.layout.layout(true);
                return [];
            }
            var context = contextDropdown.selection._value;
            var uses = findShortcutUses(shortcut);
            var conflicts = [];
            var other = [];
            var i;
            for (i = 0; i < uses.length; i++) {
                var line = "・" + uses[i].command.name + "（" +
                    (contextLabels[uses[i].context] || uses[i].context) + "）";
                if (uses[i].context === context) { conflicts.push(uses[i]); }
                else { other.push(line); }
            }
            var lines = [];
            if (conflicts.length) {
                lines.push("同じコンテキストで使用中（保存時に置き換え可能）");
                for (i = 0; i < conflicts.length; i++) { lines.push("・" + conflicts[i].command.name); }
            } else if (!uses.length) {
                lines.push("このキーはほかのコマンドで使用されていません。");
            }
            if (other.length) {
                if (lines.length) { lines.push(""); }
                lines.push("別コンテキストで使用中（そのまま併用）");
                lines = lines.concat(other);
            }
            conflictText.text = lines.join("\n");
            conflictText.visible = lines.length > 0;
            conflictText.preferredSize.height = lines.length > 2 ? 62 : 36;
            conflictText.maximumSize.height = lines.length > 2 ? 62 : 36;
            saveButton.enabled = true;
            w.layout.layout(true);
            return conflicts;
        }

        function showSelectedCommand(command) {
            selectedCommand = command;
            detailName.text = command.name;
            detailShortcut.text = command.shortcutText;
            detailArea.text = "機能エリア: " + command.area;
            detailAction.text = command.area === "スクリプト"
                ? "内部識別番号: " + (command.actionIdExpression || "選択時に自動取得")
                : "action-id: " + (command.actionIdExpression || "未調査");
            invokeButton.enabled = Boolean(command.executable);
            captureDisplay.text = "";
            captureDisplay._raw = "";
            manualInput.text = "";
            conflictText.text = "";
            conflictText.visible = false;
            conflictText.preferredSize.height = 0;
            conflictText.maximumSize.height = 0;

            if (!command.actionIdExpression) {
                var resolved = parseResult(gyahteiResolveMenuAction(resolutionCandidates(command)));
                if (resolved.ok) {
                    command.actionId = resolved.actionId;
                    command.actionIdExpression = resolved.actionIdExpression;
                    command.internalName = command.area === "スクリプト"
                        ? fullScriptInternalName(command, resolved.name)
                        : (resolved.internalName || "");
                    command.executable = resolved.actionIdUnsigned < 4278190080;
                    detailArea.text = "機能エリア: " + command.area;
                    detailAction.text = command.area === "スクリプト"
                        ? "内部識別番号: " + resolved.actionIdExpression + "（自動）"
                        : "action-id: " + resolved.actionIdExpression;
                    invokeButton.enabled = command.executable;
                }
            }
            editorGroup.visible = Boolean(currentSet && command.actionIdExpression);
            if (editorGroup.visible) {
                var preferred = command.assignments.length ? command.assignments[0].context : "DefaultContext";
                var i;
                for (i = 0; i < contextDropdown.items.length; i++) {
                    if (contextDropdown.items[i]._value === preferred) {
                        contextDropdown.selection = i;
                        break;
                    }
                }
                updateSaveMode();
                updateCurrentAssignments();
            } else if (!command.actionIdExpression) {
                setStatus("このコマンドのaction-idを特定できないため編集できません");
            }
            w.layout.layout(true);
        }

        function addSetItem(set, selectIt) {
            var item = setDropdown.add("item", set.name + "（" + set.kind + "）");
            item._set = set;
            if (selectIt) { setDropdown.selection = item; }
            return item;
        }

        function loadSet(set, selectionKey) {
            if (!set || !set.path) { return; }
            setStatus("ショートカットセットを読込中…");
            var result = parseResult(gyahteiReadShortcutSet(set.path));
            if (!result.ok) {
                alert(result.message || "ショートカットセットを読み込めません", "ショートカット検索");
                setStatus(result.message || "読込失敗");
                return;
            }
            currentSet = {name: result.name, path: result.path, kind: result.kind};
            rebuildCommands(result.records || []);
            render();
            restoreCommandSelection(selectionKey);
            reloadButton.enabled = true;
            setStatus(result.name + " を読み込みました");
        }

        function refreshCurrentScriptCatalog() {
            var result = parseResult(gyahteiListCurrentScripts());
            currentScriptCatalog = result.ok ? (result.scripts || []) : [];
            return result;
        }

        function listSets(preferredPath, selectionKey) {
            var result = parseResult(gyahteiListShortcutSets());
            setDropdown.removeAll();
            if (!result.ok) {
                alert(result.message || "セット一覧を取得できません", "ショートカット検索");
                return;
            }
            var selectedItem = null;
            var i;
            for (i = 0; i < result.sets.length; i++) {
                var item = addSetItem(result.sets[i], false);
                if (preferredPath && result.sets[i].path === preferredPath) { selectedItem = item; }
            }
            if (selectedItem) { setDropdown.selection = selectedItem; }
            else if (setDropdown.items.length) { setDropdown.selection = 0; }
            if (setDropdown.selection) { loadSet(setDropdown.selection._set, selectionKey); }
        }

        resultList.onChange = function () {
            if (resultList.selection && resultList.selection._command) {
                showSelectedCommand(resultList.selection._command);
            }
        };
        searchInput.onChanging = render;
        areaDropdown.onChange = render;
        definedOnly.onClick = function () { saveSettings(); render(); };
        executableOnly.onClick = render;
        setDropdown.onChange = function () {
            if (setDropdown.selection && setDropdown.selection._set) {
                loadSet(setDropdown.selection._set);
            }
        };
        reloadButton.onClick = function () {
            var selectionKey = commandSelectionKey(selectedCommand);
            refreshCurrentScriptCatalog();
            if (currentSet) { loadSet(currentSet, selectionKey); }
        };
        chooseButton.onClick = function () {
            var result = parseResult(gyahteiChooseShortcutSet());
            if (!result.ok) {
                if (!result.canceled) { alert(result.message, "ショートカット検索"); }
                return;
            }
            var item = addSetItem(result.set, true);
            setDropdown.selection = item;
            loadSet(result.set);
        };
        var captureDialogOpening = false;
        function captureShortcutIntoDisplay() {
            if (!selectedCommand || captureDialogOpening) { return; }
            captureDialogOpening = true;
            try {
                var result = parseResult(gyahteiCaptureShortcut());
                if (!result.ok) {
                    if (!result.canceled) { alert(result.message, "ショートカット検索"); }
                    return;
                }
                captureDisplay._raw = result.shortcut;
                captureDisplay.text = displayShortcut(result.shortcut);
                manualInput.text = "";
                updateConflictDisplay();
            } finally {
                captureDialogOpening = false;
            }
        }
        captureButton.onClick = captureShortcutIntoDisplay;
        captureDisplay.addEventListener("mousedown", function (event) {
            try { event.preventDefault(); } catch (ignorePrevent) {}
            try { event.stopPropagation(); } catch (ignoreStop) {}
            captureShortcutIntoDisplay();
        }, true);
        manualInput.onChanging = function () {
            captureDisplay._raw = "";
            captureDisplay.text = "";
            updateConflictDisplay();
        };
        contextDropdown.onChange = updateConflictDisplay;
        invokeButton.onClick = function () {
            if (!selectedCommand || !selectedCommand.executable) { return; }
            var result = parseResult(gyahteiInvokeMenuAction(selectedCommand.actionId));
            if (!result.ok) { alert(result.message || "コマンドを実行できません", "ショートカット検索"); }
            else { setStatus(result.message); }
        };
        saveButton.onClick = function () {
            if (!selectedCommand || !currentSet) { return; }
            if (selectedCommand.area === "スクリプト") {
                selectedCommand.internalName = fullScriptInternalName(selectedCommand, "");
            }
            var selectionKey = commandSelectionKey(selectedCommand);
            var raw = currentRawShortcut();
            if (!raw) { return; }
            var context = contextDropdown.selection._value;
            var overwrite = currentSet.kind === "ユーザー" || currentSet.kind === "パネル編集";
            var newSetName = overwrite ? currentSet.name : trim(setNameInput.text);
            var conflicts = updateConflictDisplay();
            if (conflicts.length) {
                var names = [];
                var i;
                for (i = 0; i < conflicts.length; i++) { names.push("・" + conflicts[i].command.name); }
                if (!confirm("「" + displayShortcut(raw) + "」は次のコマンドで使用中です。\n\n" +
                        names.join("\n") + "\n\n続けると、上記コマンドからこのキーを解除し、\n「" +
                        selectedCommand.name + "」へ割り当てます。", false,
                        "ショートカットを置き換えますか？")) {
                    return;
                }
            }
            var result = parseResult(gyahteiSaveShortcutSet(
                currentSet.path, newSetName, selectedCommand.actionIdExpression,
                selectedCommand.internalName, context, raw, overwrite
            ));
            if (!result.ok) {
                alert(result.message || "保存できません", "ショートカット検索");
                setStatus(result.message || "保存失敗");
                return;
            }
            listSets(result.path, selectionKey);
            setStatus(result.message);
        };
        deleteButton.onClick = function () {
            if (!selectedCommand || !currentSet || !currentDropdown.selection) { return; }
            var selectionKey = commandSelectionKey(selectedCommand);
            var assignment = currentDropdown.selection._assignment;
            var overwrite = currentSet.kind === "ユーザー" || currentSet.kind === "パネル編集";
            var newSetName = overwrite ? currentSet.name : trim(setNameInput.text);
            var destination = overwrite
                ? "ユーザーセット「" + currentSet.name + "」を上書きします。"
                : "プリセットは変更せず、「" + newSetName + "」へ別名保存します。";
            if (!confirm("「" + selectedCommand.name + "」から次の割り当てを削除します。\n\n" +
                    (contextLabels[assignment.context] || assignment.context) + ": " +
                    displayShortcut(assignment.shortcut) + "\n\n" + destination,
                    false, "ショートカットを削除しますか？")) {
                return;
            }
            var result = parseResult(gyahteiDeleteShortcutAssignment(
                currentSet.path, newSetName,
                assignment.actionIdExpression || selectedCommand.actionIdExpression,
                assignment.internalName || selectedCommand.internalName,
                assignment.context, assignment.shortcut, overwrite
            ));
            if (!result.ok) {
                alert(result.message || "削除できません", "ショートカット検索");
                setStatus(result.message || "削除失敗");
                return;
            }
            listSets(result.path, selectionKey);
            setStatus(result.message);
        };

        w.onResizing = function () { this.layout.resize(); };
        w.onResize = function () { this.layout.resize(); saveSettings(); };
        w.onClose = function () { saveSettings(); $.global.shortcutSearchWindow = null; };

        refreshCurrentScriptCatalog();
        rebuildCommands([]);
        render();
        listSets("");
        w.layout.layout(true);
        w.size = [savedSettings.width, savedSettings.height];
        w.center();
        w.show();
    } catch (error) {
        alert("ショートカット検索を起動できません。\n\n" + error.message +
            (error.line ? "\n行: " + error.line : ""), "ショートカット検索");
    }
}());
