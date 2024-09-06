import { Utils } from "../utils/Utils.mjs";
import { WorkerMessageHandler } from "../worker/WorkerMessageHandler.mjs";
import { SliceDirection, Viewer3DSlice } from "./Viewer3D.mjs";

const FuseWorkerPath = import.meta.resolve('../worker/FuseWorker.mjs');
const MaxCanvasSize = 4096;
export class StitchVisualizer {
    constructor(options) {
        this.options = options;
        this.ui = {};
        this.images = [];
        this.viewers = [];
        this.fusedWorkers = [];
        this.offsets = [];
        this.interactiveTiles = [];
        this.offsetCache = {};
        this.centerOffset = { x: 0, y: 0 };
        this.sliceDirection = SliceDirection.Z;
        this.currentSliceFromMiddle = 0;
        this.scale = 1;
        this.isEditing = false;
        this.directionCache = {};
        this.setupUI();
    }
    getCurrentSliceForImage(imageIndex) {
        const bounds = this.getFrameBounds();
        const offset = this.getOffsetForImage(imageIndex);
        return this.currentSliceFromMiddle + Math.floor(bounds.depth / 2) - bounds.minZ - offset.z
    }

    getSliceBounds() {
        const bounds = this.getFrameBounds();
        const minZ = bounds.minZ;
        const maxZ = bounds.maxZ;
        const depth = bounds.depth;
        const halfDepth = Math.floor(depth / 2);

        const minSlice = minZ - halfDepth;
        const maxSlice = minSlice + depth - 1;
        return {
            min: minSlice,
            max: maxSlice
        }
    }

    createFuseWorker() {
        // Create main canvas
        const canvas = document.createElement('canvas');
        canvas.classList.add('main-canvas');
        canvas.style.display = 'none';
        this.ui.imagesContainer.appendChild(canvas);

        const fuseWorker = new WorkerMessageHandler(new Worker(FuseWorkerPath, {
            type: 'module'
        }));

        const offscreen = canvas.transferControlToOffscreen();
        fuseWorker.emit('setup~', offscreen, [offscreen]);

        return {
            worker: fuseWorker,
            canvas: canvas,
            offset: { x: 0, y: 0, width: 0, height: 0 }
        }
    }

    async renderFused() {
        const bounds = this.getFrameBounds();
        const index = this.currentSliceFromMiddle;

        const { width, height } = bounds;

        const numX = Math.ceil(width / MaxCanvasSize);
        const numY = Math.ceil(height / MaxCanvasSize);

        const canvasWidth = Math.min(width, MaxCanvasSize);
        const canvasHeight = Math.min(height, MaxCanvasSize);

        const canvasAmount = numX * numY;

        if (this.fusedWorkers.length < canvasAmount) {
            for (let i = this.fusedWorkers.length; i < canvasAmount; i++) {
                this.fusedWorkers.push(this.createFuseWorker());
            }
        } else if (this.fusedWorkers.length > canvasAmount) {
            this.fusedWorkers.slice(canvasAmount).forEach(({ worker, canvas }) => {
                worker.close();
                canvas.remove();
            });
            this.fusedWorkers = this.fusedWorkers.slice(0, canvasAmount);
        }

        const promises = this.fusedWorkers.map(async ({ worker, canvas, offset }, i) => {
            const x = i % numX;
            const y = Math.floor(i / numX);
            const offsetX = x * MaxCanvasSize;
            const offsetY = y * MaxCanvasSize;
            const sizeX = Math.min(width - offsetX, MaxCanvasSize);
            const sizeY = Math.min(height - offsetY, MaxCanvasSize);

            offset.x = offsetX;
            offset.y = offsetY;
            offset.width = sizeX;
            offset.height = sizeY;

            canvas.style.display = 'none';

            const sliceDatas = [];
            const offsets = [];
            const imageBoundsList = [];
            this.images.forEach((image, i) => {
                const imageBounds = this.getBoundsForImage(i);
                const minX = imageBounds.minX - bounds.minX;
                const minY = imageBounds.minY - bounds.minY;
                const minZ = imageBounds.minZ - bounds.minZ;
                // Check if image is within bounds
                if (minX >= offsetX + sizeX || minX + imageBounds.width <= offsetX || minY >= offsetY + sizeY || minY + imageBounds.height <= offsetY) {
                    return;
                }

                // Check if z is within bounds
                const newIndex = index - minZ + Math.floor(bounds.depth / 2);
                if (newIndex < 0 || newIndex >= imageBounds.depth) {
                    return;
                }

                sliceDatas.push(this.viewers[i].sliceData);
                offsets.push(this.offsets[i]);
                imageBoundsList.push(imageBounds);
            });

            const canvasBounds = {
                ...bounds,
                minX: offsetX + bounds.minX,
                minY: offsetY + bounds.minY,
                width: sizeX,
                height: sizeY
            }

            await worker.emit('render', index, canvasBounds, imageBoundsList, sliceDatas);

            if (!this.rerenderFuse) {
                canvas.style.display = '';
            }
        });

        this.applyTransforms();

        await Promise.all(promises);
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('stitch-visualizer');

        // Create image container
        this.ui.imagesContainer = document.createElement('div');
        this.ui.imagesContainer.classList.add('image-container');
        this.ui.container.appendChild(this.ui.imagesContainer);

        // Controls.
        this.ui.controlsContainer = document.createElement('div');
        this.ui.controlsContainer.classList.add('controls');
        this.ui.container.appendChild(this.ui.controlsContainer);

        // Add info panel
        this.ui.infoPanel = document.createElement('div');
        this.ui.infoPanel.classList.add('info-panel');
        this.ui.container.appendChild(this.ui.infoPanel);

        // Add slice index display
        this.ui.sliceIndexDisplay = document.createElement('span');
        this.ui.sliceIndexDisplay.classList.add('slice-index-display');
        this.ui.infoPanel.appendChild(this.ui.sliceIndexDisplay);

        // Add position/value display
        this.ui.positionValueDisplay = document.createElement('span');
        this.ui.positionValueDisplay.classList.add('position-value-display');
        this.ui.infoPanel.appendChild(this.ui.positionValueDisplay);

        // Add slice slider
        this.ui.sliceSlider = document.createElement('input');
        this.ui.sliceSlider.classList.add('slice-slider');
        this.ui.sliceSlider.type = 'range';
        this.ui.sliceSlider.min = 0;
        this.ui.sliceSlider.max = 0; // Will be set later based on image depth
        this.ui.sliceSlider.value = 0;

        this.ui.controlsContainer.appendChild(this.ui.sliceSlider);

        // Add event listener for depth slider
        this.ui.sliceSlider.addEventListener('input', (event) => {
            this.setSliceIndex(parseInt(event.target.value), true);
        });


        // Add buttons for slice direction
        this.ui.sliceDirectionButtons = {};
        this.ui.sliceDirectionButtonsContainer = document.createElement('div');
        this.ui.sliceDirectionButtonsContainer.classList.add('slice-direction-buttons');
        this.ui.controlsContainer.appendChild(this.ui.sliceDirectionButtonsContainer);

        Object.values(SliceDirection).forEach(direction => {
            const button = document.createElement('button');
            button.classList.add('slice-direction-button-' + direction.toLowerCase());
            button.textContent = direction;
            button.addEventListener('click', () => {
                this.setSliceDirection(direction)
            });
            this.ui.sliceDirectionButtonsContainer.appendChild(button);
            this.ui.sliceDirectionButtons[direction] = button;
        });

        // Hook scroll event for zooming
        if (!this.options?.noZoom) {
            this.ui.imagesContainer.addEventListener('wheel', (event) => {
                event.preventDefault();

                const mousePos = this.getMousePosInContainer(event);
                const imageCoords = this.mousePosToImageCoords(mousePos);

                // Zoom in/out centered on mouse position
                const zoomFactor = 0.04;
                const scaleChange = event.deltaY > 0 ? -zoomFactor : (event.deltaY < 0 ? zoomFactor : 0);
                this.scale *= (1 + scaleChange);

                // Adjust center offset based on zoom
                const newImageCoords = this.mousePosToImageCoords(mousePos);
                this.centerOffset.x += (newImageCoords.x - imageCoords.x) * this.scale;
                this.centerOffset.y += (newImageCoords.y - imageCoords.y) * this.scale;


                this.applyTransforms();
            });
        }

        // Hook click and drag for panning
        this.isDragging = false;
        let startDragPos = { x: 0, y: 0 };
        let startDragOffset = { x: 0, y: 0 };


        let mouseMoveHandler, mouseUpHandler;
        mouseMoveHandler = (event) => {
            if (!this.isDragging) return;
            this.centerOffset.x = event.clientX - startDragPos.x + startDragOffset.x;
            this.centerOffset.y = event.clientY - startDragPos.y + startDragOffset.y;

            this.applyTransforms();
        }

        mouseUpHandler = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        }
        if (!this.options?.noPan) {
            this.ui.imagesContainer.addEventListener('mousedown', (event) => {
                if (this.isEditing) {
                    return;
                }
                if (!event.button === 0) return; // Only left mouse button
                this.isDragging = true;
                startDragPos = { x: event.clientX, y: event.clientY };
                startDragOffset = { x: this.centerOffset.x, y: this.centerOffset.y };

                document.addEventListener('mousemove', mouseMoveHandler);
                document.addEventListener('mouseup', mouseUpHandler);
            });
        }

        this.ui.imagesContainer.addEventListener('mousemove', (event) => {
            const mousePos = this.getMousePosInContainer(event);
            const imageCoords = this.mousePosToImageCoords(mousePos);
            let value = null;
            let values = [];
            const bounds = this.getFrameBounds();
            this.viewers.forEach((viewer, i) => {
                if (viewer.sliceData) {
                    const offset = this.getOffsetForImage(i);
                    const frames = viewer.getSliceCount();
                    const z = this.getCurrentSliceForImage(i);
                    if (z < 0 || z >= frames) {
                        return;
                    }


                    const { width, height } = viewer.sliceDataDimensions;
                    const x = Math.floor(imageCoords.x) - offset.x + bounds.minX;
                    const y = Math.floor(imageCoords.y) - offset.y + bounds.minY;
                    if (x >= 0 && x < width && y >= 0 && y < height) {
                        values.push(viewer.sliceData[y * width + x])
                    }
                }

            })

            if (values.length > 0) {
                value = values.join(', ');
            }

            this.ui.positionValueDisplay.textContent = `(${imageCoords.x.toFixed(2)}, ${imageCoords.y.toFixed(2)}): ${value !== null ? value : ''}`;
        });

        this.ui.imagesContainer.tabIndex = -1;
        this.ui.imagesContainer.addEventListener('keydown', (event) => {
            const sliceBounds = this.getSliceBounds();
            if (event.code === 'ArrowLeft') {
                this.setSliceIndex(Utils.clamp(this.currentSliceFromMiddle - 1, sliceBounds.min, sliceBounds.max));
            } else if (event.code === 'ArrowRight') {
                this.setSliceIndex(Utils.clamp(this.currentSliceFromMiddle + 1, sliceBounds.min, sliceBounds.max));
            } else if (event.code === 'KeyX') {
                this.setSliceDirection(SliceDirection.X);
            } else if (event.code === 'KeyY') {
                this.setSliceDirection(SliceDirection.Y);
            } else if (event.code === 'KeyZ') {
                this.setSliceDirection(SliceDirection.Z);
            } else if (event.code === 'Space') {
                this.centerAndScale();
            } else {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        });
    }

    getElement() {
        return this.ui.container;
    }

    createInteractiveTile(i) {
        const tile = document.createElement('div');
        tile.classList.add('interactive-tile');
        tile.dataset.index = i;
        this.ui.imagesContainer.appendChild(tile);
        this.interactiveTiles.push(tile);

        // Add tile label
        const label = document.createElement('div');
        label.classList.add('tile-label');

        const check = () =>{
               // Check if label fits inside the container, if not then move it above the tile
               const tileWidth = tile.offsetWidth;
               const tileHeight = tile.offsetHeight;
               const labelWidth = label.offsetWidth;
               const labelHeight = label.offsetHeight;
               if (labelWidth > tileWidth || labelHeight > tileHeight) {
                   label.style.transform = 'translate(0%, -100%)';
               } else {
                   label.style.transform = '';
               }
        }

        tile.addEventListener('mouseenter', () => {
            label.textContent = this.imageNames[i] + ': (' + this.offsets[i].x + ', ' + this.offsets[i].y + ', ' + this.offsets[i].z + ')';
            check();

            // Find all tiles that collide
            const bounds1 = this.getBoundsForImage(i);
            this.interactiveTiles.forEach((tile, j) => {
                if (i === j) {
                    return;
                }
                const bounds2 = this.getBoundsForImage(j);
                if (bounds1.minX < bounds2.maxX && bounds1.maxX > bounds2.minX && bounds1.minY < bounds2.maxY && bounds1.maxY > bounds2.minY && bounds1.minZ < bounds2.maxZ && bounds1.maxZ > bounds2.minZ) {
                    tile.classList.add('collide');
                } else {
                    tile.classList.remove('collide');
                }
            });
        });

        tile.addEventListener('wheel', (event) => {
            check();
        });

        tile.addEventListener('mouseleave', () => {
            check();

            this.interactiveTiles.forEach(tile => {
                tile.classList.remove('collide');
            });
        });

        // When double clicked, enter edit mode which can be used to adjust tile position
        
        tile.addEventListener('dblclick', (e) => {
            if (this.isEditing) {
                this.endEditMode();
            } else {
                this.startEditMode(i, e);
            }
        });

        tile.appendChild(label);
    }

    endEditMode() {
        if (!this.isEditing) {
            return;
        }

        this.isEditing = false;
        this.editingTile.removeEventListener('mousedown', this.mouseDownListener);
        this.editingTile.classList.remove('editing');
        this.editingTile = null;
    }

    startEditMode(i, event) {
        if (this.isEditing) {
            return;
        }

        this.isEditing = true;

        let moveListener, mouseUpListener;
        let currentPos, currentMousePos;


        moveListener = (event) => {
            const offsetX = event.clientX - currentMousePos.x;
            const offsetY = event.clientY - currentMousePos.y;

            const newx = Math.round(currentPos.x + offsetX / this.scale);
            const newy = Math.round(currentPos.y + offsetY / this.scale);

            this.setOffsetForImage(i, { x: newx, y: newy });

            this.updateOffsets();
            this.requestFusedRender();

            event.preventDefault();
        }


        mouseUpListener = (event) => {
            document.removeEventListener('mousemove', moveListener);
            document.removeEventListener('mouseup', mouseUpListener);
        }

        const mouseDownListener = (event) => {
            if (event.button !== 0) {
                return;
            }

            const offset = this.getOffsetForImage(i);
            currentPos = { x: offset.x, y: offset.y };
            currentMousePos = { x: event.clientX, y: event.clientY };

            document.addEventListener('mousemove', moveListener);
            document.addEventListener('mouseup', mouseUpListener);
        }
        
        this.mouseDownListener = mouseDownListener;
        this.editingTile = this.interactiveTiles[i];
        this.editingTile.classList.add('editing');
        this.interactiveTiles[i].addEventListener('mousedown', mouseDownListener);
    }


    setImages(imagesIn, offsetsIn, namesIn) {
        const images = [];
        const offsets = [];
        const names = [];

        imagesIn.forEach((image, i) => {
            if (!image) {
                return;
            }

            const offset = offsetsIn[i];
            if (!offset) {
                return;
            }

            offset.x = Math.round(offset.x);
            offset.y = Math.round(offset.y);
            offset.z = Math.round(offset.z);
            offset.width = Math.round(offset.width);
            offset.height = Math.round(offset.height);
            offset.depth = Math.round(offset.depth);

            images.push(image);
            offsets.push(offset);
            names.push(namesIn[i]);
        });


        let lastLen = this.images.length;
        const viewers = [];
        this.images.forEach((image, i) => {
            this.ui.imagesContainer.removeChild(this.viewers[i].canvas);
        });

        this.imageNames = names || [];

        if (this.interactiveTiles.length > images.length) {
            this.interactiveTiles.slice(images.length).forEach(tile => {
                this.ui.imagesContainer.removeChild(tile);
            });

            this.interactiveTiles = this.interactiveTiles.slice(0, images.length);
        } else if (this.interactiveTiles.length < images.length) {
            for (let i = this.interactiveTiles.length; i < images.length; i++) {
                this.createInteractiveTile(i);
            }
        }

        images.forEach((image, i) => {
            const matchedViewer = this.viewers.findIndex(viewer => viewer.image === image);

            if (matchedViewer !== -1) {
                viewers.push(this.viewers[matchedViewer]);
                this.ui.imagesContainer.appendChild(this.viewers[matchedViewer].canvas);
            } else {
                const viewer = new Viewer3DSlice();
                viewers.push(viewer);
                this.ui.imagesContainer.appendChild(viewer.canvas);
            }


            const viewer = viewers[i];
            viewer.setImage(image);
            viewer.setSliceDirection(this.sliceDirection);

        });
        this.viewers = viewers;
        this.images = images;
        this.offsets = offsets;

        this.invalidateCache();
        if (lastLen !== this.images.length) {
            this.centerAndScale();
        }
        
        const sliceBounds = this.getSliceBounds();
        this.setSliceIndex(Utils.clamp(this.currentSliceFromMiddle, sliceBounds.min, sliceBounds.max), true);
        this.updateSliceSlider();
        this.requestFusedRender();
    }

    invalidateCache() {
        this.cachedBounds = null;
    }

    getStitchedBounds() {
        if (this.cachedBounds) {
            return this.cachedBounds;
        }

        if (this.images.length === 0) {
            return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, width: 0, height: 0, depth: 0 };
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < this.images.length; i++) {
            const { x, y, z } = this.offsets[i];
            const { width, height, depth } = this.images[i];

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x + width);
            maxY = Math.max(maxY, y + height);
            maxZ = Math.max(maxZ, z + depth);
        }

        // Check for infinities and throw error
        if (minX === Infinity || minY === Infinity || minZ === Infinity || maxX === -Infinity || maxY === -Infinity || maxZ === -Infinity) {
            throw new Error('Invalid bounds');
        }

        this.cachedBounds = { minX, minY, minZ, maxX, maxY, maxZ, width: maxX - minX, height: maxY - minY, depth: maxZ - minZ };
        return this.cachedBounds;
    }

    setOffsetForImage(imageIndex, newoff) {
        const direction = this.sliceDirection;
        const offsets = this.offsets[imageIndex];
        switch (direction) {
            case SliceDirection.X:
                if (newoff.x !== undefined) offsets.z = newoff.x;
                if (newoff.y !== undefined) offsets.y = newoff.y;
                if (newoff.z !== undefined) offsets.x = newoff.z;
                break;
            case SliceDirection.Y:
                if (newoff.x !== undefined) offsets.x = newoff.x;
                if (newoff.y !== undefined) offsets.z = newoff.y;
                if (newoff.z !== undefined) offsets.y = newoff.z;
                break;
            case SliceDirection.Z:
                if (newoff.x !== undefined) offsets.x = newoff.x;
                if (newoff.y !== undefined) offsets.y = newoff.y;
                if (newoff.z !== undefined) offsets.z = newoff.z;
                break;
        }
    }

    getOffsetForImage(imageIndex) {
        const offsets = this.offsets[imageIndex];
        const direction = this.sliceDirection;

        switch (direction) {
            case SliceDirection.X:
                return { x: offsets.z, y: offsets.y, z: offsets.x };
            case SliceDirection.Y:
                return { x: offsets.x, y: offsets.z, z: offsets.y };
            case SliceDirection.Z:
                return { x: offsets.x, y: offsets.y, z: offsets.z };
        }
    }

    getBoundsForImage(imageIndex) {
        const { x, y, z } = this.offsets[imageIndex];
        const { width, height, depth } = this.images[imageIndex];
        switch (this.sliceDirection) {
            case SliceDirection.X:
                return { minX: z, minY: y, maxX: z + depth, maxY: y + height, minZ: x, maxZ: x + width, width: depth, height: height, depth: width };
            case SliceDirection.Y:
                return { minX: x, minY: z, maxX: x + width, maxY: z + depth, minZ: y, maxZ: y + height, width: width, height: depth, depth: height };
            case SliceDirection.Z:
                return { minX: x, minY: y, maxX: x + width, maxY: y + height, minZ: z, maxZ: z + depth, width: width, height: height, depth: depth };
        }
    }

    getFrameBounds() {
        const bounds = this.getStitchedBounds();
        const direction = this.sliceDirection;
        switch (direction) {
            case SliceDirection.X:
                return { width: bounds.depth, height: bounds.height, depth: bounds.width, minX: bounds.minZ, minY: bounds.minY, maxX: bounds.maxZ, maxY: bounds.maxY, minZ: bounds.minX, maxZ: bounds.maxX };
            case SliceDirection.Y:
                return { width: bounds.width, height: bounds.depth, depth: bounds.height, minX: bounds.minX, minY: bounds.minZ, maxX: bounds.maxX, maxY: bounds.maxZ, minZ: bounds.minY, maxZ: bounds.maxY };
            case SliceDirection.Z:
                return { width: bounds.width, height: bounds.height, depth: bounds.depth, minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY, minZ: bounds.minZ, maxZ: bounds.maxZ };
        }
    }

    getSliceCount() {
        if (this.images.length === 0) {
            return 1;
        }
        return this.getFrameBounds().maxZ - this.getFrameBounds().minZ;
    }

    async render() {
        // Check if viewer is visible
        if (this.ui.container.offsetParent === null) {
            return;
        }

        const index = this.currentSliceFromMiddle;
        const bounds = this.getFrameBounds();
        const minZ = bounds.minZ;
        const results = [];
        for (let i = 0; i < this.viewers.length; i++) {
            const viewer = this.viewers[i];
            let result = await viewer.render(true)
            results.push(result);
        }

        // Schedule restash
        this.images.forEach((image, i) => {
            if (!image.stashScheduled()) {
                image.scheduleStash(10000);
            }
        });

        if (results.some(result => result === true)) {
            this.ui.sliceIndexDisplay.textContent = `${this.sliceDirection}=${this.currentSliceFromMiddle}/${bounds.depth}`;

            this.viewers.forEach((viewer, i) => {
                const offset = this.getOffsetForImage(i);
                const newIndex = index - offset.z + minZ + Math.floor(bounds.depth / 2);
                if (newIndex < 0 || newIndex >= viewer.getSliceCount()) {
                    viewer.canvas.style.display = 'none';
                } else {
                    viewer.canvas.style.display = '';
                }
            });
        }


        if (this.rerenderFuse) {
            this.rerenderFuse = false;
            await this.renderFused();
        }
    }

    applyTransforms() {
        const bounds = this.getFrameBounds();
        const midPoint = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2
        };

        for (let i = 0; i < this.viewers.length; i++) {
            const viewer = this.viewers[i];
            const { x, y } = this.getOffsetForImage(i);
            const { width, height } = this.getBoundsForImage(i);

            const offsetX = (x - midPoint.x + width / 2) * this.scale + this.centerOffset.x - width / 2;
            const offsetY = (y - midPoint.y + height / 2) * this.scale + this.centerOffset.y - height / 2;

            viewer.canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.scale})`;

            const interactiveTile = this.interactiveTiles[i];
            interactiveTile.style.width = width * this.scale + 'px';
            interactiveTile.style.height = height * this.scale + 'px';
            const offsetX2 = (x - midPoint.x) * this.scale + this.centerOffset.x;
            const offsetY2 = (y - midPoint.y) * this.scale + this.centerOffset.y;
            interactiveTile.style.transform = `translate(${offsetX2}px, ${offsetY2}px)`;
        }

        this.fusedWorkers.forEach(({ canvas, offset }) => {
            const { x, y, width, height } = offset;
            const offsetX = (x - bounds.width / 2 + width / 2) * this.scale + this.centerOffset.x - width / 2;
            const offsetY = (y - bounds.height / 2 + height / 2) * this.scale + this.centerOffset.y - height / 2;
            canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.scale})`;
        });

    }


    updateSliceSlider() {
        const bounds = this.getSliceBounds();
        this.ui.sliceSlider.min = bounds.min;
        this.ui.sliceSlider.max = bounds.max;
        this.ui.sliceSlider.value = this.currentSliceFromMiddle;
    }

    requestFusedRender() {
        this.rerenderFuse = true;
        this.fusedWorkers.forEach(({ canvas }) => {
            canvas.style.display = 'none';
        });
    }

    setSliceIndex(index, updateSlider = false) {
        this.currentSliceFromMiddle = index;
        this.updateOffsets();
        if (updateSlider) {
            this.updateSliceSlider();
        }
        this.requestFusedRender();
    }

    updateOffsets() {
        this.invalidateCache();
        this.viewers.forEach((viewer, i) => {
            const offset = this.getOffsetForImage(i);
            const newIndex = this.getCurrentSliceForImage(i);
            if (newIndex < 0 || newIndex >= viewer.getSliceCount()) {
                viewer.canvas.style.display = 'none';
                this.interactiveTiles[i].style.display = 'none';
            } else {
                viewer.setSliceIndex(newIndex);
                this.interactiveTiles[i].style.display = '';
            }
        });

        this.applyTransforms();
    }

    setSliceDirection(direction) {
        Object.values(SliceDirection).forEach(dir => {
            this.ui.sliceDirectionButtons[dir].classList.toggle('active', dir === direction);
        });

        if (this.sliceDirection === direction) {
            return;
        }

        // Save to cache
        this.directionCache[this.sliceDirection] = {
            sliceIndex: this.currentSliceFromMiddle,
            centerOffset: { x: this.centerOffset.x, y: this.centerOffset.y },
            scale: this.scale
        };

        this.sliceDirection = direction;
        this.viewers.forEach(viewer => viewer.setSliceDirection(direction));
        this.invalidateCache();

        // Restore from cache
        const cache = this.directionCache[direction];
        if (cache) {
            const bounds = this.getSliceBounds();
            const newCurrentSlice = Utils.clamp(cache.sliceIndex, bounds.min, bounds.max);
            this.centerOffset = { x: cache.centerOffset.x, y: cache.centerOffset.y };
            this.scale = cache.scale;

            this.setSliceIndex(newCurrentSlice, true);
            this.applyTransforms();
        } else {
            this.setSliceIndex(0, true);
            this.centerAndScale();
        }

        this.updateSliceSlider();
        this.requestFusedRender();
    }

    centerAndScale() {
        const { width, height } = this.getFrameBounds();

        // Get width and height of the container
        const containerRect = this.ui.imagesContainer.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerHeight = Math.max(containerRect.height - 40, 1);

        // Calculate scale based on the container size
        this.scale = Math.min(containerWidth / width, containerHeight / height);
        this.centerOffset = { x: 0, y: -17.5 }; // Center the image vertically

        this.applyTransforms();
    }

    getMousePosInContainer(event) {
        const rect = this.ui.imagesContainer.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        return {
            x: event.clientX - rect.left - width / 2,
            y: event.clientY - rect.top - height / 2
        };
    }

    mousePosToImageCoords(mousePos) {
        const { width, height } = this.getFrameBounds();
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        return {
            x: (mousePos.x - this.centerOffset.x) / this.scale + halfWidth,
            y: (mousePos.y - this.centerOffset.y) / this.scale + halfHeight,
        };

    }

    destroy() {
        this.viewers.forEach(viewer => viewer.destroy());
        this.fusedWorkers.forEach(({ worker }) => worker.close());

        this.viewers = [];
        this.fusedWorkers = [];
    }


}