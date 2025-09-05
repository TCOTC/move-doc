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

export default class PluginSample extends Plugin {
    public setting: Setting;

    async onload() {
        // "open-menu-doctree": {
        //     menu: subMenu,
        //     elements: NodeListOf<HTMLElement>,
        //     type: "doc" | "docs" | "notebook",
        // };
        this.eventBus.on('open-menu-doctree', this.openMenuDoctree);

        await this.loadData(STORAGE_NAME);
        this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc ??= true;

        this.setting = new Setting({
            confirmCallback: () => {
                this.saveData(STORAGE_NAME, {expandDocTreeAfterMoveDoc: (document.getElementById("expandDocTreeAfterMoveDoc") as HTMLInputElement).checked});
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
    }

    onunload() {
        this.eventBus.off('open-menu-doctree', this.openMenuDoctree);
    }

    uninstall() {
        this.eventBus.off('open-menu-doctree', this.openMenuDoctree);
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
            targetDocId = element?.getAttribute('data-node-id');
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
            const targetDocPath = element?.getAttribute('data-path');
            if (!targetDocPath || targetDocPath.includes(currentDoc.id)) {
                // 排除子文档
                return;
            }
        } else if (type === "notebook") {
            targetNotebookId = element?.parentElement?.getAttribute('data-url');
            if (!targetNotebookId || (currentDoc.notebookId === targetNotebookId && currentDoc.path.length <= 26)) {
                // 如果文档在笔记本根目录的话需要排除当前笔记本
                return;
            }
        } else {
            // 不支持其他类型
            return;
        }

        menu.addItem({
            id: `move-doc_to-this-${type.toLowerCase()}`,
            icon: "iconMove",
            label: this.i18n[`moveToThis${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`],
            click: async () => {
                const res = await fetchSyncPost('/api/filetree/moveDocsByID', {
                    fromIDs: [currentDoc.id],
                    toID: targetDocId || targetNotebookId,
                });
                if (res.code !== 0) {
                    // 移动文档失败
                    showMessage(this.displayName + ": " + this.i18n.moveDocFailed, undefined, "error", "move-doc_move-doc-failed");
                    return;
                }
                let notebook: string;
                let path: string;
                if (targetDocId) {
                    const res2 = await fetchSyncPost('/api/filetree/getPathByID', {
                        id: currentDoc.id,
                    });
                    console.log("res2", res2);
                    notebook = res2.data?.notebook;
                    path = res2.data?.path;
                    if (res2.code !== 0 || !notebook || !path) {
                        // 获取文档路径失败
                        showMessage(this.displayName + ": " + this.i18n.getPathByIDFailed, undefined, "error", "move-doc_get-path-by-id-failed");
                        return;
                    }
                    targetNotebookId = notebook;
                }
                const res3 = await fetchSyncPost('/api/filetree/listDocsByPath', {
                    notebook: targetNotebookId,
                    path: targetDocId || "/",
                    maxListCount: 1, // 只需要获取最上面的文档的排序就够了
                    showHidden: true, // 包含隐藏的文档
                    ignoreMaxListHint: true, // 忽略最大数量提示
                });
                console.log("res3", res3);
                const firstDocId = res3.data?.files[0]?.id;
                const firstDocSort = res3.data?.files[0]?.sort;
                if (res3.code !== 0 || !firstDocId || !firstDocSort) {
                    // 通过路径获取文档失败
                    showMessage(this.displayName + ": " + this.i18n.getDocsByPathFailed, undefined, "error", "move-doc_get-docs-by-path-failed");
                    return;
                }
                if (firstDocId !== currentDoc.id) {
                    // TODO: 修改排序，需要原生 API https://github.com/siyuan-note/siyuan/issues/15776
                    // 这个 API 不能指定排序值：
                    // const res4 = await fetchSyncPost("/api/filetree/changeSort", {
                    //     paths: [path],      // 新的排序路径数组
                    //     notebook: notebook  // 目标笔记本 ID
                    // });
                    // console.log("res4", res4);
                }
                // 等待文档移动并排序完成之后才能展开文档树
                if (this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc) {
                    // 移动文档之后展开文档树 https://github.com/TCOTC/move-doc/issues/2
                    expandDocTree({ id: currentDoc.id });
                }
            }
        });
    };

    getCurrentDoc = (): { id: string, path: string, notebookId: string } | null => {
        // 原生函数获取当前文档 protyle https://github.com/siyuan-note/siyuan/issues/15415
        const editor = getActiveEditor(false);
        const protyle = editor?.protyle;
        if (!protyle || !protyle.block?.rootID || !protyle.path || !protyle.notebookId) return null;
        return {
            id: protyle.block.rootID,
            path: protyle.path,
            notebookId: protyle.notebookId
        };
    };
}