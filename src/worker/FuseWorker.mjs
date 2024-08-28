import { WorkerMessageHandler } from "./WorkerMessageHandler.mjs";



class FuseWorker {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = false;
        this.cachedDimensions = {}
        this.weightsCache = new Map();
    }

    get_linear_weight_3d(
        width, height, depth,
        x, y, z,
        alpha = 1.5,
    ) {
        let min_distance = 1.0;
        min_distance *= (Math.min(x, width - x - 1) + 1);
        min_distance *= (Math.min(y, height - y - 1) + 1);
        min_distance *= (Math.min(z, depth - z - 1) + 1);
    
        min_distance += 1.0;
        return Math.pow(min_distance,alpha);
    }

    getWeights(width, height, depth, z) {
        const key = `${width}-${height}-${depth}-${z}`;
        if (this.weightsCache.has(key)) {
            return this.weightsCache.get(key);
        }

        const weights = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                weights[y * width + x] = this.get_linear_weight_3d(width, height, depth, x, y, z);
            }
        }
        

        this.weightsCache.set(key, weights);
        return weights;
    }

    render(index, bounds, imageBoundsList, sliceDatas) {
        const {width: cachedWidth, height: cachedHeight} = this.cachedDimensions;
        const {width, height} = bounds;
        const minZ = bounds.minZ;

        if (cachedWidth !== width || cachedHeight !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.cachedDimensions.width = width;
            this.cachedDimensions.height = height;
            this.weightsTotals = new Float32Array(width * height);
            this.finalSlice = new Uint8Array(width * height);
            this.imageData = this.ctx.createImageData(width, height);
        }

        const weightsTotals = this.weightsTotals;
        weightsTotals.fill(0);

        imageBoundsList.forEach((imageBounds, i) => {
            const {width: imageWidth, height: imageHeight, depth: imageDepth} = imageBounds;
            const offset = {x: imageBounds.minX, y: imageBounds.minY, z: imageBounds.minZ};
            const newIndex = index - offset.z + minZ + Math.floor(bounds.depth / 2);
            if (newIndex < 0 || newIndex >= imageDepth) {
           
            } else {
                const weights = this.getWeights(imageWidth, imageHeight, imageDepth, newIndex);
                const offset_x = offset.x - bounds.minX;
                const offset_y = offset.y - bounds.minY;
                const minX = Math.max(0, -offset_x);
                const minY = Math.max(0, -offset_y);
                const maxX = Math.min(imageWidth, width - offset_x);
                const maxY = Math.min(imageHeight, height - offset_y);
                for (let y = minY; y < maxY; y++) {
                    for (let x = minX; x < maxX; x++) {
                        const weight = weights[y * imageWidth + x];
                        weightsTotals[(y + offset_y) * width + x + offset_x] += weight;
                    }
                }
            }
        });

        const finalSlice = this.finalSlice;
        finalSlice.fill(0);

        imageBoundsList.forEach((imageBounds, i) => {
            const {width: imageWidth, height: imageHeight, depth: imageDepth} = imageBounds;
            const offset = {x: imageBounds.minX, y: imageBounds.minY, z: imageBounds.minZ};
            const newIndex = index - offset.z + minZ + Math.floor(bounds.depth / 2);
            if (newIndex < 0 || newIndex >= imageDepth) {
           
            } else {
                const weights = this.getWeights(imageWidth, imageHeight, imageDepth, newIndex);
                const offset_x = offset.x - bounds.minX;
                const offset_y = offset.y - bounds.minY;
                const sliceData = sliceDatas[i];
                const minX = Math.max(0, -offset_x);
                const minY = Math.max(0, -offset_y);
                const maxX = Math.min(imageWidth, width - offset_x);
                const maxY = Math.min(imageHeight, height - offset_y);
                for (let y = minY; y < maxY; y++) {
                    for (let x = minX; x < maxX; x++) {
                        const weight = weights[y * imageWidth + x];
                        const index = (y + offset_y) * width + x + offset_x;
                        const totalWeight = weightsTotals[index];
                        finalSlice[index] += Math.round(weight * sliceData[y * imageWidth + x] / totalWeight);
                    }
                }
            }
        });

        const imageData = this.imageData;
        for (let i = 0; i < width * height; i++) {
            const value = finalSlice[i];
            imageData.data[i * 4] = value;
            imageData.data[i * 4 + 1] = value;
            imageData.data[i * 4 + 2] = value;
            imageData.data[i * 4 + 3] = 255;
        }

        this.ctx.putImageData(imageData, 0, 0);
    }
}

const messageHandler = new WorkerMessageHandler(self);
let instance;
messageHandler.on('setup', (canvas) => {  
    instance = new FuseWorker(canvas);
});

messageHandler.on('render', async (index, bounds, imageBoundsList, sliceDatas) => {  
    instance.render(index, bounds, imageBoundsList, sliceDatas);
});
