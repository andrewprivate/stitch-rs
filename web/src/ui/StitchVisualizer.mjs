import { Utils } from "../utils/Utils.mjs";
import { SliceDirection, Viewer3DSlice } from "./Viewer3D.mjs";

export class StitchVisualizer {
    constructor() {
        this.ui = {};
        this.images = [];
        this.viewers = [];
        this.offsets = [];
        this.centerOffset = { x: 0, y: 0 };
        this.sliceDirection = SliceDirection.Z;
        this.currentSliceFromMiddle = 0;
        this.scale = 1;
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

        this.ui.imagesContainer.addEventListener('mousedown', (event) => {
            if (!event.button === 0) return; // Only left mouse button
            this.isDragging = true;
            startDragPos = { x: event.clientX, y: event.clientY };
            startDragOffset = { x: this.centerOffset.x, y: this.centerOffset.y };

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });

        this.ui.imagesContainer.addEventListener('mousemove', (event) => {
            const mousePos = this.getMousePosInContainer(event);
            const imageCoords = this.mousePosToImageCoords(mousePos);
            let value = null;
            let values = [];
            const bounds = this.getFrameBounds();
            this.viewers.forEach((viewer, i)=>{
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

        this.ui.imagesContainer.tabIndex = 0;
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
            }
        });
    }

    getElement() {
        return this.ui.container;
    }

    setImages(images, offsets) {
        images.forEach((image, i) => {
            this.addImage(image, offsets[i].x, offsets[i].y, offsets[i].z);
        });

        this.invalidateCache();
        this.centerAndScale();
        this.setSliceIndex(0, true);
        this.updateSliceSlider();
    }

    addImage(image, offsetX, offsetY, offsetZ) {
        this.images.push(image);
        const viewer = new Viewer3DSlice();
        viewer.setImage(image);
        viewer.setSliceDirection(this.sliceDirection);
        this.viewers.push(viewer);
        this.ui.imagesContainer.appendChild(viewer.canvas);
        this.offsets.push({ x: offsetX, y: offsetY, z: offsetZ });
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
                return { minX: z, minY: y, maxX: z + depth, maxY: y + height, width: depth, height: height };
            case SliceDirection.Y:
                return { minX: x, minY: z, maxX: x + width, maxY: z + depth, width: width, height: depth };
            case SliceDirection.Z:
                return { minX: x, minY: y, maxX: x + width, maxY: y + height, width: width, height: height };
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
        const index = this.currentSliceFromMiddle;
        const bounds = this.getFrameBounds();
        const results = [];
        for (let i = 0; i < this.viewers.length; i++) {
            const viewer = this.viewers[i];
            let result = await viewer.render(true)
            results.push(result);
        }

        // Schedule restash
        this.images.forEach((image, i) => {
            if (!image.stashScheduled()) {
                image.scheduleStash(5000);
            }
        });

        if (results.some(result => result === true)) {
            this.ui.sliceIndexDisplay.textContent = `${this.sliceDirection}=${this.currentSliceFromMiddle}/${bounds.depth}`;

            const minZ = bounds.minZ;
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
            const {width, height} = this.getBoundsForImage(i);

            const offsetX = (x - midPoint.x + width / 2) * this.scale + this.centerOffset.x - width / 2;
            const offsetY = (y - midPoint.y + height / 2) * this.scale + this.centerOffset.y - height / 2;

            viewer.canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.scale})`;
        }
    }


    updateSliceSlider() {
        const bounds = this.getSliceBounds();
        this.ui.sliceSlider.min = bounds.min;
        this.ui.sliceSlider.max = bounds.max;
        this.ui.sliceSlider.value = this.currentSliceFromMiddle;
    }

    setSliceIndex(index, updateSlider = false) {
        this.currentSliceFromMiddle = index;
        this.updateOffsets();
        if (updateSlider) {
            this.updateSliceSlider();
        }
    }

    updateOffsets() {
        this.invalidateCache();
        this.viewers.forEach((viewer, i) => {
            const offset = this.getOffsetForImage(i);
            const newIndex = this.getCurrentSliceForImage(i);
            if (newIndex < 0 || newIndex >= viewer.getSliceCount()) {
                viewer.canvas.style.display = 'none';
            } else {
                viewer.setSliceIndex(newIndex);
            }
        });
    }

    setSliceDirection(direction) {

        if (this.sliceDirection === direction) {
            this.centerAndScale();
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
        Object.values(SliceDirection).forEach(dir => {
            this.ui.sliceDirectionButtons[dir].classList.toggle('active', dir === direction);
        });

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
    }

    centerAndScale() {
        const { width, height } = this.getFrameBounds();

        // Get width and height of the container
        const containerRect = this.ui.imagesContainer.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerHeight = Math.max(containerRect.height - 40, 0);

        // Calculate scale based on the container size
        this.scale = Math.min(containerWidth / width, containerHeight / height);
        this.centerOffset = { x: 0, y: -30 * this.scale }; // Center the image vertically

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


}