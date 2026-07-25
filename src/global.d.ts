declare module "*.scss";

interface Window {
    siyuan: {
        config: {
            fileTree: {
                createDocAtTop: boolean;
            };
        };
        languages: {
            _kernel: Record<number, string>;
        };
    };
    Lute: {
        EscapeHTMLStr: (html: string) => string;
    };
}
