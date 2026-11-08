import {
    Plugin,
    Setting,
    fetchSyncPost,
    getActiveEditor,
    expandDocTree,
    showMessage,
    type FileTreeFile,
    type IEventBusMap,
} from "siyuan";
import "./index.scss";

const STORAGE_NAME = "move-doc-config.json";

/** 自定义排序模式，使 listDocsByPath 按自定义顺序返回，首个 / 末个文档即为真实首尾 */
const SORT_MODE_CUSTOM = 6;

/** 移动文档到目标子文档列表中的位置 */
type MoveDocPosition = "follow" | "top" | "bottom";

/** 相对锚点文档的排序位置，与 reorderDocs 的 position 取值一致 */
type SortPosition = "before" | "after";

/** 相对目标文档的位置 */
type RelativeSortPosition = "above" | "below";

/** 移动目标：笔记本，或该笔记本中的一个文档 */
type MoveDocTarget = {
    notebookId: string;
    /** 目标文档路径，同时也是其子文档列表的 listPath；省略时按笔记本根目录处理 */
    docPath?: string;
    /** 目标文档 ID，目标列表为空时用于直接移动 */
    docId?: string;
    /** 目标子文档列表当前生效的排序方式 */
    listSortMode: number | undefined;
};

/** 排序锚点：error 为 true 表示列表读取失败，anchorId 为空表示目标列表为空 */
type ChildAnchor = {
    error: boolean;
    anchorId?: string;
};

export default class PluginSample extends Plugin {
    async onload() {
        this.eventBus.on("open-menu-doctree", this.openMenuDoctree);

        await this.loadData(STORAGE_NAME);
        // loadData 在配置文件不存在时返回空字符串，需归一化为对象
        if (typeof this.data[STORAGE_NAME] !== "object" || this.data[STORAGE_NAME] === null) {
            this.data[STORAGE_NAME] = {};
        }
        this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc ??= true;
        this.data[STORAGE_NAME].moveDocPosition ??= "follow";

        this.setting = new Setting({
            confirmCallback: () => {
                this.saveData(STORAGE_NAME, {
                    expandDocTreeAfterMoveDoc: (document.getElementById("expandDocTreeAfterMoveDoc") as HTMLInputElement).checked,
                    moveDocPosition: (document.getElementById("moveDocPosition") as HTMLSelectElement).value as MoveDocPosition,
                });
            }
        });

        this.setting.addItem({
            // 移动文档之后展开文档树
            title: this.i18n.expandDocTreeAfterMoveDoc,
            direction: "column",
            createActionElement: () => {
                const input = document.createElement("input");
                input.type = "checkbox";
                input.classList.add("b3-switch", "fn__flex-center");
                input.id = "expandDocTreeAfterMoveDoc";
                input.checked = this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc;
                return input;
            }
        });

        this.setting.addItem({
            // 移动文档到目标位置的子文档列表中的位置
            title: this.i18n.moveDocPosition,
            description: this.i18n.moveDocPositionDesc,
            direction: "column",
            createActionElement: () => {
                const select = document.createElement("select");
                select.classList.add("b3-select", "fn__flex-center");
                select.id = "moveDocPosition";
                const options: { value: MoveDocPosition; label: string }[] = [
                    { value: "follow", label: this.i18n.moveDocPositionFollow },
                    { value: "top", label: this.i18n.moveDocPositionTop },
                    { value: "bottom", label: this.i18n.moveDocPositionBottom },
                ];
                for (const item of options) {
                    const option = document.createElement("option");
                    option.value = item.value;
                    option.textContent = item.label;
                    select.appendChild(option);
                }
                select.value = this.data[STORAGE_NAME].moveDocPosition;
                return select;
            }
        });

        console.log(this.displayName, "plugin loaded")
    }

    onunload() {
        this.eventBus.off("open-menu-doctree", this.openMenuDoctree);

        console.log(this.displayName, "plugin unloaded")
    }

    async uninstall() {
        await this.removeData(STORAGE_NAME);

        console.log(this.displayName, "plugin uninstalled")
    }

    openMenuDoctree = (event: CustomEvent<IEventBusMap["open-menu-doctree"]>) => {
        const type = event.detail.type;
        const menu = event.detail.menu;
        const item = event.detail.items[0];
        if (!item) {
            return;
        }

        const currentDoc = this.getCurrentDoc();
        if (!currentDoc) {
            // 当前文档不存在
            return;
        }

        const displayName = currentDoc.name.length > 10 ? currentDoc.name.slice(0, 10) + "..." : currentDoc.name;
        const escapedName = window.Lute.EscapeHTMLStr(displayName);

        // 仅处理单个文档或单个笔记本；多选与混选不提供移动入口
        if (type === "doc") {
            const targetDocId = item?.id;
            const targetDocPath = item?.path;
            const targetNotebookId = item?.notebookId;
            if (!targetDocId || !targetDocPath || !targetNotebookId) {
                return;
            }
            if (targetDocId === currentDoc.id) {
                // 排除当前文档
                return;
            }
            if (targetDocPath.includes(currentDoc.id)) {
                // 排除子文档
                return;
            }

            // 自定义排序下可相对目标文档精确插入；其他排序规则下位置由规则决定，只能选择该层
            const listSortMode = item.effectiveSortMode;
            if (listSortMode === SORT_MODE_CUSTOM) {
                // 移动到该文档上方 / 下方 https://github.com/TCOTC/move-doc/issues/8
                menu.addItem({
                    id: "move-doc_above-this-doc",
                    icon: "iconUp",
                    label: this.i18n.moveAboveThisDoc.replace("{currentDoc}", escapedName),
                    click: async () => {
                        await this.moveDocBeside(currentDoc.id, targetDocId, "above");
                    }
                });
                menu.addItem({
                    id: "move-doc_below-this-doc",
                    icon: "iconDown",
                    label: this.i18n.moveBelowThisDoc.replace("{currentDoc}", escapedName),
                    click: async () => {
                        await this.moveDocBeside(currentDoc.id, targetDocId, "below");
                    }
                });
            } else {
                // 移动到该文档所在层级，在该层级中的位置由设置决定 https://github.com/TCOTC/move-doc/issues/9
                menu.addItem({
                    id: "move-doc_to-same-level",
                    icon: "iconMove",
                    label: this.i18n.moveToSameLevel.replace("{currentDoc}", escapedName),
                    click: async () => {
                        await this.moveDocToSameLevel(currentDoc.id, targetDocPath, targetNotebookId, listSortMode);
                    }
                });
            }

            const isParent = currentDoc.path.slice(-48).includes(targetDocId);
            if (!isParent) {
                // 移动为该文档的子文档（排除父文档：已在其下时移动无效）
                menu.addItem({
                    id: "move-doc_to-this-doc",
                    icon: "iconMove",
                    label: this.i18n.moveToThisDoc.replace("{currentDoc}", escapedName),
                    click: async () => {
                        await this.moveDocAsChild(currentDoc.id, {
                            notebookId: targetNotebookId,
                            docPath: targetDocPath,
                            docId: targetDocId,
                            // 子文档列表的排序方式取该文档的声明，未声明时继承其自身所在层
                            listSortMode: item.childrenSortMode ?? listSortMode,
                        });
                    }
                });
            }
        } else if (type === "notebook") {
            const targetNotebookId = item?.notebookId;
            if (!targetNotebookId || (currentDoc.notebookId === targetNotebookId && currentDoc.path.length <= 26)) {
                // 如果文档在笔记本根目录的话需要排除当前笔记本
                return;
            }
            menu.addItem({
                id: "move-doc_to-this-notebook",
                icon: "iconMove",
                label: this.i18n.moveToThisNotebook.replace("{currentDoc}", escapedName),
                click: async () => {
                    await this.moveDocAsChild(currentDoc.id, {
                        notebookId: targetNotebookId,
                        listSortMode: item.effectiveSortMode,
                    });
                }
            });
        }
    };

    /** 移动为子文档，并按配置调整排序 */
    moveDocAsChild = async (fromID: string, target: MoveDocTarget): Promise<void> => {
        const moved = await this.placeDocInList(fromID, target.notebookId, target.docPath ?? "/",
            target.docId ?? target.notebookId, target.listSortMode);
        if (moved) {
            this.expandAfterMove(fromID);
        }
    };

    /** 移动到目标文档所在层级，并按配置调整排序 */
    moveDocToSameLevel = async (
        fromID: string,
        targetDocPath: string,
        targetNotebookId: string,
        listSortMode: number | undefined,
    ): Promise<void> => {
        const parentListPath = this.getParentListPath(targetDocPath);
        const parentId = this.getParentTargetId(targetDocPath, targetNotebookId);
        const moved = await this.placeDocInList(fromID, targetNotebookId, parentListPath, parentId, listSortMode);
        if (moved) {
            this.expandAfterMove(fromID);
        }
    };

    /** 移动到目标文档的上方或下方，仅在目标层使用自定义排序时提供 */
    moveDocBeside = async (fromID: string, targetDocId: string, position: RelativeSortPosition): Promise<void> => {
        const moved = await this.reorderDocs([fromID], targetDocId, position === "above" ? "before" : "after");
        if (moved) {
            this.expandAfterMove(fromID);
        }
    };

    /**
     * 把文档移入目标列表。列表已使用自定义排序时按设置放到开头或末尾，
     * 其他排序规则下位置由规则决定，只移动、不改动排序方式。
     */
    placeDocInList = async (
        fromID: string,
        notebookId: string,
        listPath: string,
        fallbackTargetId: string,
        listSortMode: number | undefined,
    ): Promise<boolean> => {
        if (listSortMode !== SORT_MODE_CUSTOM) {
            return await this.moveDocByID(fromID, fallbackTargetId);
        }

        const placeAtTop = this.shouldPlaceAtTop();
        const anchor = await this.getChildAnchor(notebookId, listPath, placeAtTop);
        if (anchor.error) {
            return false;
        }
        if (!anchor.anchorId) {
            // 目标列表为空，开头与末尾没有差别，直接移动
            return await this.moveDocByID(fromID, fallbackTargetId);
        }
        if (anchor.anchorId === fromID) {
            // 已在目标位置，无需调整
            return true;
        }
        return await this.reorderDocs([fromID], anchor.anchorId, placeAtTop ? "before" : "after");
    };

    /** 移动文档之后展开文档树 https://github.com/TCOTC/move-doc/issues/2 */
    expandAfterMove = (fromID: string): void => {
        if (this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc) {
            expandDocTree({ id: fromID });
        }
    };

    /** 将文档移动到目标文档或笔记本下 */
    moveDocByID = async (fromID: string, toID: string): Promise<boolean> => {
        const res = await fetchSyncPost("/api/filetree/moveDocsByID", {
            fromIDs: [fromID],
            toID,
        });
        if (res.code !== 0) {
            showMessage(this.displayName + ": " + this.i18n.moveDocFailed, undefined, "error", "move-doc_move-doc-failed");
            return false;
        }
        return true;
    };

    /** 是否将移动后的文档放到目标列表开头 */
    shouldPlaceAtTop = (): boolean => {
        const position: MoveDocPosition = this.data[STORAGE_NAME].moveDocPosition ?? "follow";
        if (position === "top") {
            return true;
        }
        if (position === "bottom") {
            return false;
        }
        // 跟随思源的「新建子文档放置在顶部」设置
        return !!window.siyuan.config.fileTree.createDocAtTop;
    };

    /** 从文档路径得到 listDocsByPath 所需的父列表路径 */
    getParentListPath = (docPath: string): string => {
        const lastSlash = docPath.lastIndexOf("/");
        if (lastSlash <= 0) {
            return "/";
        }
        return docPath.substring(0, lastSlash) + ".sy";
    };

    /** 从文档路径得到其父文档 ID 或笔记本 ID（供 moveDocsByID 使用） */
    getParentTargetId = (docPath: string, notebookId: string): string => {
        const parentListPath = this.getParentListPath(docPath);
        if (parentListPath === "/") {
            return notebookId;
        }
        // "/xxx.sy" 或 "/a/b.sy" → 去掉 .sy 后取最后一段 ID
        return parentListPath.substring(parentListPath.lastIndexOf("/") + 1, parentListPath.length - 3);
    };

    /**
     * 一次调用完成移动与相对排序，由内核按完整同级列表计算位置。
     * 仅在目标列表已使用自定义排序时调用，不会改动排序方式。
     */
    reorderDocs = async (sourceIDs: string[], targetID: string, position: SortPosition): Promise<boolean> => {
        const res = await fetchSyncPost("/api/filetree/reorderDocs", {
            sourceIDs,
            targetID,
            position,
            respectSort: true,
        });
        if (res.code !== 0) {
            showMessage(this.displayName + ": " + this.i18n.moveDocFailed, undefined, "error", "move-doc_move-doc-failed");
            return false;
        }
        if (res.data?.conflict) {
            // 列表排序方式在操作期间变化时内核不会执行，避免静默失败
            showMessage(this.displayName + ": " + this.i18n.sortModeChanged, undefined, "error", "move-doc_sort-mode-changed");
            return false;
        }
        return true;
    };

    /** 取目标列表的第一个或最后一个文档作为排序锚点 */
    getChildAnchor = async (notebookId: string, listPath: string, first: boolean): Promise<ChildAnchor> => {
        const res = await fetchSyncPost("/api/filetree/listDocsByPath", {
            notebook: notebookId,
            path: listPath,
            sort: SORT_MODE_CUSTOM,
            // 取第一个只需取一条；取最后一个需要完整列表（0 表示不限制）
            maxListCount: first ? 1 : 0,
            showHidden: true,
            ignoreMaxListHint: true,
        });
        if (res.code !== 0) {
            showMessage(this.displayName + ": " + this.i18n.getDocsByPathFailed, undefined, "error", "move-doc_get-docs-by-path-failed");
            return { error: true };
        }

        // files 的元素可能为 null，先过滤再取首尾
        const files = (res.data?.files ?? []).filter((file): file is FileTreeFile => file !== null);
        if (files.length === 0) {
            return { error: false };
        }
        return { error: false, anchorId: first ? files[0].id : files[files.length - 1].id };
    };

    getCurrentDoc = (): { id: string, path: string, notebookId: string, name: string } | null => {
        // 原生函数获取当前文档 protyle https://github.com/siyuan-note/siyuan/issues/15415
        const editor = getActiveEditor(false);
        const protyle = editor?.protyle;
        if (!protyle || !protyle.block?.rootID || !protyle.path || !protyle.notebookId) return null;
        // 桌面端取 protyle 标题元素，实时反映编辑中的标题；移动端 render.titleShowTop 为 true，标题显示在顶栏，
        // protyle 内不生成标题元素，getText() 返回 setTitle() 记录的文档标题，空标题时回退为“未命名文档”
        const name = protyle.title?.getText() || window.siyuan.languages._kernel[16] || "";
        return {
            id: protyle.block.rootID,
            path: protyle.path,
            notebookId: protyle.notebookId,
            name,
        };
    };
}
