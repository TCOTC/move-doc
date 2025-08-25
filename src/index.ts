import {
    Plugin,
    Menu,
    Setting,
    fetchPost,
    getActiveEditor
} from "siyuan";
// import "./index.scss";

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

    // onLayoutReady() {
    // }

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
        };
        let targetId: string;

        // doc: 单个文档；docs: 多个文档 / 文档与笔记本混合；notebook: 单个笔记本
        if (type === "doc") {
            const targetDocId = element?.getAttribute('data-node-id');
            if (!targetDocId || currentDoc.path.slice(-48).includes(targetDocId)) {
                // 排除当前文档、父文档
                return;
            };
            targetId = targetDocId;
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
            };
        } else if (type === "notebook") {
            const targetNotebookId = element?.parentElement?.getAttribute('data-url');
            if (!targetNotebookId || (currentDoc.notebookId === targetNotebookId && currentDoc.path.length <= 26)) {
                // 如果文档在笔记本根目录的话需要排除当前笔记本
                return;
            };
            targetId = targetNotebookId;
        } else {
            // 不支持其他类型
            return;
        }

        menu.addItem({
            id: `move-doc_to-this-${type.toLowerCase()}`,
            icon: "iconMove",
            label: this.i18n[`moveToThis${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`],
            click: async () => {
                fetchPost('/api/filetree/moveDocsByID', {
                    fromIDs: [currentDoc.id],
                    toID: targetId,
                });
                if (this.data[STORAGE_NAME].expandDocTreeAfterMoveDoc) {
                    // 移动文档之后展开文档树 https://github.com/TCOTC/move-doc/issues/2
                    element.querySelector(".b3-list-item__toggle:has(svg.b3-list-item__arrow:not(.b3-list-item__arrow--open))")?.click();
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