import { GrayImage3D } from "../Image.mjs";

export class WrappedFile {
    constructor(name, entry) {
        this.name = name;
        this.entry = entry;
        this.metaData = null;

        this.metaDataPromise = null;
        this.metaDataPromise = new Promise((resolve, reject) => {
            this.metaDataResolve = resolve;
        });
    }

    getExtension() {
        return this.name.split(".").pop();
    }

    getMetaData() {
        return this.metaData;
    }

    async getMetaDataLazy() {
        return this.metaDataPromise
    }

    getName() {
        return this.name;
    }

    isText() {
        const extensions = ["txt", "csv", "json", "md"];
        return extensions.includes(this.getExtension());
    }

    async getFile() {
        const file = await this.entry.getFile();
        this.metaData = {};
        this.metaData.lastModified = file.lastModified;
        this.metaData.size = file.size;
        this.metaData.type = file.type;

        if (this.metaDataResolve) {
            this.metaDataResolve(this.metaData);
            this.metaDataResolve = null;
        }

        return file;
    }

    async getText() {
        const file = await this.getFile();
        return await file.text();
    }

    async getArrayBuffer() {
        const file = await this.getFile();
        return await file.arrayBuffer();
    }

    async write(data) {
        const writable = await this.entry.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async toImage() {
        return await GrayImage3D.fromBlobFile(this.getFile(), this.getExtension());
    }
}

export class FileUtils {
    static async getEntries(fs) {
        const entries = fs.entries();
        const result = [];
        for await (const [name, entry] of entries) {
            result.push(new WrappedFile(name, entry));
        }

        return result;
    }
}