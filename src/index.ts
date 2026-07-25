import {
    Plugin,
    Menu,
    Setting,
    fetchSyncPost,
    getActiveEditor,
    expandDocTree,
    showMessage,
} from "siyuan";
import "./index.scss";

const STORAGE_NAME = "move-doc-config.json";

/** 自定义排序模式，确保 listDocsByPath 返回有效的 sort 字段 */
const SORT_MODE_CUSTOM = 6;

/** 移动文档到目标子文档列表中的位置 */
type MoveDocPosition = "follow" | "top" | "bottom";

export default class PluginSample extends Plugin {
    async onload() {
        // "open-menu-doctree": {
        //     menu: subMenu,
        //     elements: NodeListOf<HTMLElement>,
        //     type: "doc" | "docs" | "notebook",
        // };
        this.eventBus.on("open-menu-doctree", this.openMenuDoctree);

        await this.loadData(STORAGE_NAME);
        this.data[STORAGE_NAME] ??= {};
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
    }

    onunload() {
        this.eventBus.off("open-menu-doctree", this.openMenuDoctree);
    }

    async uninstall() {
        await this.removeData(STORAGE_NAME);
    }

    openMenuDoctree = (event: CustomEvent) => {
        const type = event.detail.type;
        const menu = event.detail.menu as Menu;
        const element = event.detail.elements[0];

        const currentDoc = this.getCurrentDoc();
        if (!currentDoc) {
            // 当前文档不存在
            return;
        }

        let targetDocId: string;
        let targetNotebookId: string;
        // doc: 单个文档；docs: 多个文档 / 文档与笔记本混合；notebook: 单个笔记本
        if (type === "doc") {
            targetDocId = element?.getAttribute("data-node-id");
            if (!targetDocId || currentDoc.path.slice(-48).includes(targetDocId)) {
                // 排除当前文档、父文档
                return;
            }
            // TODO跟进: 目前不支持使用异步操作 https://github.com/siyuan-note/siyuan/issues/15676
            // const targetDocInfo = await fetchSyncPost("/api/block/getBlockInfo", { id: targetDocId });
            // if (!targetDocInfo?.data?.path || targetDocInfo.data.path.includes(currentDoc.id)) {
            //     // 排除子文档
            //     return;
            // };
            // TODO功能: 考虑在事件参数里传递路径信息，不需要耗时请求 https://github.com/siyuan-note/siyuan/pull/15620
            const targetDocPath = element?.getAttribute("data-path");
            if (!targetDocPath || targetDocPath.includes(currentDoc.id)) {
                // 排除子文档
                return;
            }
        } else if (type === "notebook") {
            targetNotebookId = element?.parentElement?.getAttribute("data-url");
            if (!targetNotebookId || (currentDoc.notebookId === targetNotebookId && currentDoc.path.length <= 26)) {
                // 如果文档在笔记本根目录的话需要排除当前笔记本
                return;
            }
        } else {
            // 不支持其他类型
            return;
        }

        const displayName = currentDoc.name.length > 30 ? currentDoc.name.slice(0, 30) + "..." : currentDoc.name;
        const labelKey = `moveToThis${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`;
        menu.addItem({
            id: `move-doc_to-this-${type.toLowerCase()}`,
            icon: "iconMove",
            label: this.i18n[labelKey].replace("{currentDoc}", window.Lute.EscapeHTMLStr(displayName)),
            click: async () => {
                const moved = await this.moveDocByID(currentDoc.id, targetDocId || targetNotebookId);
                if (!moved) {
                    return;
                }

                // 按配置将文档排序到目标位置的开头或末尾 https://github.com/TCOTC/move-doc/issues/3
                await this.applyMoveDocSort(currentDoc.id, targetNotebookId);

                // 等待文档移动并排序完成之后才能展开文档树
                if (this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc) {
                    // 移动文档之后展开文档树 https://github.com/TCOTC/move-doc/issues/2
                    expandDocTree({ id: currentDoc.id });
                }
            }
        });
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

    /** 是否将移动后的文档放到子文档列表开头 */
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

    /** 从文档路径得到 listDocsByPath 所需的父路径 */
    getParentListPath = (docPath: string): string => {
        const lastSlash = docPath.lastIndexOf("/");
        if (lastSlash <= 0) {
            return "/";
        }
        return docPath.substring(0, lastSlash) + ".sy";
    };

    /** 移动文档后，按配置调整自定义排序 */
    applyMoveDocSort = async (docId: string, knownNotebookId?: string): Promise<void> => {
        const placeAtTop = this.shouldPlaceAtTop();

        const pathRes = await fetchSyncPost("/api/filetree/getPathByID", {
            id: docId,
        });
        const notebook: string = pathRes.data?.notebook || knownNotebookId;
        const docPath: string = pathRes.data?.path;
        if (pathRes.code !== 0 || !notebook || !docPath) {
            showMessage(this.displayName + ": " + this.i18n.getPathByIDFailed, undefined, "error", "move-doc_get-path-by-id-failed");
            return;
        }

        const listPath = this.getParentListPath(docPath);
        const listRes = await fetchSyncPost("/api/filetree/listDocsByPath", {
            notebook,
            path: listPath,
            sort: SORT_MODE_CUSTOM,
            // 放到开头时只需取第一个；放到末尾时取全部（0 表示不限制）
            maxListCount: placeAtTop ? 1 : 0,
            showHidden: true,
            ignoreMaxListHint: true,
        });
        const files: { id: string; sort: number }[] = listRes.data?.files ?? [];
        if (listRes.code !== 0 || files.length === 0) {
            showMessage(this.displayName + ": " + this.i18n.getDocsByPathFailed, undefined, "error", "move-doc_get-docs-by-path-failed");
            return;
        }

        const anchor = placeAtTop ? files[0] : files[files.length - 1];
        if (anchor.id === docId) {
            // 已在目标位置，无需调整
            return;
        }

        const sortVal = placeAtTop ? anchor.sort - 1 : anchor.sort + 1;
        const sortRes = await fetchSyncPost("/api/filetree/setSort", {
            docSorts: [{ id: docId, sort: sortVal }],
        });
        if (sortRes.code !== 0) {
            showMessage(this.displayName + ": " + this.i18n.setSortFailed, undefined, "error", "move-doc_set-sort-failed");
        }
    };

    getCurrentDoc = (): { id: string, path: string, notebookId: string, name: string } | null => {
        // 原生函数获取当前文档 protyle https://github.com/siyuan-note/siyuan/issues/15415
        const editor = getActiveEditor(false);
        const protyle = editor?.protyle;
        if (!protyle || !protyle.block?.rootID || !protyle.path || !protyle.notebookId) return null;
        // 从 protyle 标题元素获取文档名称，空标题时回退为“未命名文档”
        const name = protyle.title?.editElement?.textContent || window.siyuan.languages._kernel[16] || "";
        return {
            id: protyle.block.rootID,
            path: protyle.path,
            notebookId: protyle.notebookId,
            name,
        };
    };
}
