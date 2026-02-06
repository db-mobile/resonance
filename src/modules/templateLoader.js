export class TemplateLoader {
    constructor() {
        this.cache = new Map();
    }

    loadTemplateFileSync(templateFilePath) {
        if (this.cache.has(templateFilePath)) {
            return this.cache.get(templateFilePath);
        }

        const url = new URL(templateFilePath, window.location.href);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url.toString(), false);
        xhr.send(null);

        if (xhr.status !== 200 && xhr.status !== 0) {
            throw new Error(`Failed to load template file: ${templateFilePath}`);
        }

        const html = xhr.responseText;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        this.cache.set(templateFilePath, doc);
        return doc;
    }

    async loadTemplateFile(templateFilePath) {
        if (this.cache.has(templateFilePath)) {
            return this.cache.get(templateFilePath);
        }

        const url = new URL(templateFilePath, window.location.href);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load template file: ${templateFilePath}`);
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        this.cache.set(templateFilePath, doc);
        return doc;
    }

    async clone(templateFilePath, templateId) {
        const doc = await this.loadTemplateFile(templateFilePath);
        const template = doc.getElementById(templateId);
        if (!template || template.tagName.toLowerCase() !== 'template') {
            throw new Error(`Template not found: ${templateFilePath}#${templateId}`);
        }

        return template.content.cloneNode(true);
    }

    cloneSync(templateFilePath, templateId) {
        const doc = this.loadTemplateFileSync(templateFilePath);
        const template = doc.getElementById(templateId);
        if (!template || template.tagName.toLowerCase() !== 'template') {
            throw new Error(`Template not found: ${templateFilePath}#${templateId}`);
        }

        return template.content.cloneNode(true);
    }
}

export const templateLoader = new TemplateLoader();
