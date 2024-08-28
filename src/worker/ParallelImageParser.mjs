import { GrayImage3D } from "../Image.mjs";
import { WorkerPool } from "./WorkerPool.mjs";

const WorkerLocation = import.meta.resolve('./ImageParserWorker.mjs');

export class ParallelImageParser {
    constructor() {
        this.pool = new WorkerPool(WorkerLocation);
    }

    processImageFiles(files, progressCallback) {
        let todoTotal = files.length;
        let done = 0;
        const promises = this.pool.emitBulk('file2Image', files.map(file => {
            return async () => {
                return [await file.getFile(), file.getExtension()]
            }
        }));

        const newPromises = promises.map((p, i) => {
            return p.then((result) => {
                done++;
                progressCallback(done, todoTotal);
                return GrayImage3D.fromTransfer(result);
            }).catch((e) => {
                done++;
                progressCallback(done, todoTotal);
                console.error(e);
            });
        });

        return newPromises
    }

    close() {
        this.pool.close();
    }
}