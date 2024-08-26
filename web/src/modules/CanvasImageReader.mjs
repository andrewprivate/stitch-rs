import { GrayImage3D } from "../Image.mjs";

export class CanvasImageReader {
    constructor(file) {
        this.file = file;
    }
    async getGray8() {
        const bitmap = await createImageBitmap(this.file);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(bitmap, 0, 0);
        const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const data = new Uint8Array(imageData.width * imageData.height);
        for (let i = 0; i < data.length; i++) {
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];

            data[i] = r * 0.299 + g * 0.587 + b * 0.114;
        }

        return new GrayImage3D({
            width: imageData.width,
            height: imageData.height,
            depth: 1,
            data
        });
    }
}