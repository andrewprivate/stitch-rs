export const ImageStatus = {
    LOADED_IN_MEMORY: "LOADED_IN_MEMORY",
    STASHED: "STASHED",
    DELETED: "DELETED"
}

export class GrayImage3D {
    constructor({width, height, depth, data}) {
        this.width = width;
        this.height = height;
        this.depth = depth;
        this.data = data;
        this.status = ImageStatus.LOADED_IN_MEMORY;

        this.xProjection = null;
        this.yProjection = null;
        this.zProjection = null;
    }

    static toImageData(data, width, height) {
        const imageData = new ImageData(width, height);
        for (let i = 0; i < width * height; i++) {
            const value = data[i];
            imageData.data[i * 4] = value; // R
            imageData.data[i * 4 + 1] = value; // G
            imageData.data[i * 4 + 2] = value; // B
            imageData.data[i * 4 + 3] = 255; // A
        }
        return imageData;
    }

    getZProjection() {
        return this.zProjection;
    }

    getXProjection() {
        return this.xProjection;
    }

    getYProjection() {
        return this.yProjection;
    }

    async generateProjections() {
        await this.unstash();

        const {width, height, depth, data} = this;

        const frame_size = width * height;
        
        let xProjection = new Uint8Array(depth * height);
        for (let z = 0; z < depth; z++) {
            for (let y = 0; y < height; y++) {
                let sum = 0;
                for (let x = 0; x < width; x++) {
                    sum += data[z * frame_size + y * width + x];
                }
                xProjection[z * height + y] = sum / width;
            }
        }

        this.xProjection = new Blob([xProjection], {type: "application/octet-stream"});
        xProjection = null;

        let yProjection = new Uint8Array(depth * width);
        for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let y = 0; y < height; y++) {
                    sum += data[z * frame_size + y * width + x];
                }
                yProjection[z * width + x] = sum / height;
            }
        }

        this.yProjection = new Blob([yProjection], {type: "application/octet-stream"});
        yProjection = null;

        let zProjection = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let z = 0; z < depth; z++) {
                    sum += data[z * frame_size + y * width + x];
                }
                zProjection[y * width + x] = sum / depth;
            }
        }

        this.zProjection = new Blob([zProjection], {type: "application/octet-stream"});
        zProjection = null;
    }

    async transfer() {
        if (!this.blob) {
            await this.stash();
        }
        return {
            width: this.width,
            height: this.height,
            depth: this.depth,
            blob: this.blob,
            xProjection: this.xProjection,
            yProjection: this.yProjection,
            zProjection: this.zProjection
        }
    }

    static async fromTransfer({width, height, depth, blob, xProjection, yProjection, zProjection}) {
        const image = new GrayImage3D({width, height, depth});
        image.blob = blob;
        image.status = ImageStatus.STASHED;
        image.xProjection = xProjection;
        image.yProjection = yProjection;
        image.zProjection = zProjection;
        return image;
    }

    async stash() {
        if (this.status === ImageStatus.STASHED) {
            return false;
        }
        if (!this.blob) {
            this.blob = new Blob([this.data], {type: "application/octet-stream"});
        }
        this.data = null;
        this.status = ImageStatus.STASHED;

        return true;
    }

    async unstash() {
        if (this.stashTimeout) {
            clearTimeout(this.stashTimeout);
            this.stashTimeout = null;
        }
        
        if (this.status !== ImageStatus.STASHED) {
            return false;
        }

        try {
            const buffer = await this.blob.arrayBuffer();
            this.data = new Uint8Array(buffer);
            this.status = ImageStatus.LOADED_IN_MEMORY;
        } catch (e) {
            console.error("Error unstashing image", e, this);
            throw e;
        }

        return true;
    }

    async unstashTemp(duration = 1000) {
        await this.unstash();
        this.scheduleStash(duration);
    }

    async scheduleStash(duration = 1000) {
        if (this.status === ImageStatus.STASHED) {
            return;
        }
        clearTimeout(this.stashTimeout);
        this.stashTimeout = setTimeout(() => {
            this.stashTimeout = null;
            this.stash();
        }, duration);
    }

    stashScheduled() {
        return this.status !== ImageStatus.STASHED && this.stashTimeout;
    }

    static async fromBlobFile(file, ext, progressCallback) {
        const buffer = await file.arrayBuffer();
        if (ext === "dcm") {
            const view = new DataView(buffer);
            const {daikon} = await import("./modules/daikon.mjs");
            const image = daikon.Series.parseImage(view);
            if (image === null) {
                throw new Error("Could not parse DICOM image");
            }
            
            const series = new daikon.Series();

            series.addImage(image);

            series.buildSeries();

            return series
        } else if (ext === 'tiff' || ext === 'tif') {
            const {UTIF} = await import("./modules/utif.mjs");
            const ifds = UTIF.decode(buffer);

            let depth = ifds.length;
            let width;
            let height;

            let finalArray;
            

            for (let i = 0; i < ifds.length; i++) {
                const ifd = ifds[i];

                UTIF.decodeImage(buffer, ifd);

                if (i === 0) {
                    width = ifd.width;
                    height = ifd.height;
                    finalArray = new Uint8Array(width * height * depth);
                }

                if (ifd.width !== width || ifd.height !== height) {
                    throw new Error("All images must have the same dimensions");
                }

                let gray8 = UTIF.toGray8(ifd); // uint8 array

                UTIF.data = null;

                finalArray.set(gray8, i * width * height);

                gray8 = null;

                if (progressCallback) {
                    progressCallback(i + 1, ifds.length);
                }
            }

            return new GrayImage3D({width, height, depth, data: finalArray});
        } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
            const { CanvasImageReader } = await import("./modules/CanvasImageReader.mjs");
            const reader = new CanvasImageReader(file);
            return await reader.getGray8();
        }

    }
}