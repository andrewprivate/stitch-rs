import { GrayImage3D } from "../Image.mjs";
import { WorkerMessageHandler } from "./WorkerMessageHandler.mjs";

const messageHandler = new WorkerMessageHandler(self);

messageHandler.on('file2Image', async (file, extension, progressCallback) => {  
    const image = await GrayImage3D.fromBlobFile(file, extension, progressCallback);
    return await image.transfer();
});