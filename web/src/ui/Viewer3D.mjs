import { GrayImage3D } from "../Image.mjs";
import { Utils } from "../utils/Utils.mjs";

export const SliceDirection = {
    X: "X",
    Y: "Y",
    Z: "Z",
}

export class Viewer3DSlice {
    constructor() {
        this.renderCache = {};
        this.image = null;
        this.sliceDirection = SliceDirection.Z;
        this.currentSlice = 0;

        this.setupCanvas();
    }

    setupCanvas() {
        // Create a canvas for rendering
        this.canvas = document.createElement('canvas');
        this.canvas.classList.add('image');
        this.ctx = this.canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = false;
    }

    setImage(image) {
        this.image = image;
        this.renderCache = {};
        this.sliceDirection = SliceDirection.Z;
        this.currentSlice = 0;
    }

    async render(noRestash = false) {
        if (!this.image) return false;

        const { width, height } = this.getDimensions2D();
        const { cachedWidth, cachedHeight } = this.renderCache;

        let rerender = false;

        if (cachedWidth !== width || cachedHeight !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.renderCache.cachedWidth = width;
            this.renderCache.cachedHeight = height;

            rerender = true;
        }

        const { cachedSliceIndex, cachedDirection } = this.renderCache;
        if (cachedSliceIndex !== this.currentSlice || cachedDirection !== this.sliceDirection) {
            rerender = true;
            this.renderCache.cachedSliceIndex = this.currentSlice;
            this.renderCache.cachedDirection = this.sliceDirection;
        }

        if (rerender) {
            if (noRestash) {
                await this.image.unstash();
            } else {
                await this.image.unstashTemp();
            }
            const sliceImage = await this.getSliceFrame();
            this.sliceData = sliceImage;
            this.sliceDataDimensions = { width, height };
            const imageData = GrayImage3D.toImageData(sliceImage, width, height);
            this.ctx.putImageData(imageData, 0, 0);
            return true;
        }
        return false;
    }

    async getSliceFrame() {
        const { width, height, depth } = this.image;
        const imgFrameSize = width * height;

        const { width: frameWidth, height: frameHeight } = this.getDimensions2D();

        const sliceData = new Uint8Array(frameWidth * frameHeight);

        switch (this.sliceDirection) {
            case SliceDirection.X:
                for (let z = 0; z < depth; z++) {
                    for (let y = 0; y < height; y++) {
                        sliceData[y * frameWidth + z] = this.image.data[z * imgFrameSize + y * width + this.currentSlice];
                    }
                }
                break;
            case SliceDirection.Y:
                for (let z = 0; z < depth; z++) {
                    for (let x = 0; x < width; x++) {
                        sliceData[z * frameWidth + x] = this.image.data[z * imgFrameSize + this.currentSlice * width + x];
                    }
                }
                break;
            case SliceDirection.Z:
                for (let x = 0; x < width; x++) {
                    for (let y = 0; y < height; y++) {
                        sliceData[y * frameWidth + x] = this.image.data[this.currentSlice * imgFrameSize + y * width + x];
                    }
                }
                break;
            default:
                throw new Error("Unimplemented slice direction");
        }

        return sliceData;
    }

    getDimensions2D() {
        if (!this.image) throw new Error("Image not set");

        const { width, height, depth } = this.image;

        switch (this.sliceDirection) {
            case SliceDirection.X:
                return { width: depth, height: height };
            case SliceDirection.Y:
                return { width: width, height: depth };
            case SliceDirection.Z:
                return { width: width, height: height };
            default:
                throw new Error("Unimplemented slice direction");
        }
    }

    getSliceCount() {
        if (!this.image) return 1;

        const { width, height, depth } = this.image;

        switch (this.sliceDirection) {
            case SliceDirection.X:
                return width;
            case SliceDirection.Y:
                return height;
            case SliceDirection.Z:
                return depth;
            default:
                throw new Error("Unimplemented slice direction");
        }
    }

    setSliceIndex(index) {
        const { width, height, depth } = this.image;

        if (index < 0 || index >= this.getSliceCount()) throw new Error("Index out of bounds");

        this.currentSlice = index;
    }

    setSliceDirection(direction) {
        if (!this.image) throw new Error("Image not set");

        if (this.sliceDirection === direction) return;

        if (!Object.values(SliceDirection).includes(direction)) {
            throw new Error("Invalid slice direction");
        }

        this.sliceDirection = direction;

        this.setSliceIndex(0);
    }

    destroy() {
        this.ui.container.remove();
        this.image = null;
        this.ui = {};
    }
}



export class Viewer3DSliceWithControls extends Viewer3DSlice {
    constructor() {
        super();
        this.ui = {};
        this.sliceIndexCache = {};

        this.scale = 1;
        this.centerOffset = { x: 0, y: 0 };

        this.setupUI();
    }

    getElement() {
        return this.ui.container;
    }

    setupUI() {
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('viewer3d');

        // Create image container
        this.ui.imageContainer = document.createElement('div');
        this.ui.imageContainer.classList.add('image-container');
        this.ui.container.appendChild(this.ui.imageContainer);

        this.ui.imageContainer.appendChild(this.canvas);

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
        this.ui.imageContainer.addEventListener('wheel', (event) => {
            if (!this.image) return;

            event.preventDefault();

            const mousePos = this.getMousePosInContainer(event);
            const imageCoords = this.mousePosToImageCoords(mousePos);

            const previousOffset = { x: this.centerOffset.x, y: this.centerOffset.y };
            const previousScale = this.scale;

            // Zoom in/out centered on mouse position
            const zoomFactor = 0.04;
            const scaleChange = event.deltaY > 0 ? -zoomFactor : (event.deltaY < 0 ? zoomFactor : 0);
            this.scale *= (1 + scaleChange);

            // Adjust center offset based on zoom
            const newImageCoords = this.mousePosToImageCoords(mousePos);
            this.centerOffset.x += (newImageCoords.x - imageCoords.x) * this.scale;
            this.centerOffset.y += (newImageCoords.y - imageCoords.y) * this.scale;


            this.applyTransform();
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

            this.applyTransform();
        }

        mouseUpHandler = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        }

        this.ui.imageContainer.addEventListener('mousedown', (event) => {
            if (!event.button === 0) return; // Only left mouse button
            if (!this.image) return;
            this.isDragging = true;
            startDragPos = { x: event.clientX, y: event.clientY };
            startDragOffset = { x: this.centerOffset.x, y: this.centerOffset.y };

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });

        this.ui.imageContainer.addEventListener('mousemove', (event) => {
            if (!this.image) return;
            const mousePos = this.getMousePosInContainer(event);
            const imageCoords = this.mousePosToImageCoords(mousePos);

            let value = null;
            if (this.sliceData) {
                const { width, height } = this.sliceDataDimensions;
                const x = Math.floor(imageCoords.x);
                const y = Math.floor(imageCoords.y);

                if (x >= 0 && x < width && y >= 0 && y < height) {
                    value = this.sliceData[y * width + x];
                }
            }

            this.ui.positionValueDisplay.textContent = `(${imageCoords.x.toFixed(2)}, ${imageCoords.y.toFixed(2)}): ${value !== null ? value : ''}`;
        });

        this.ui.imageContainer.tabIndex = 0;
        this.ui.imageContainer.addEventListener('keydown', (event) => {
            if (!this.image) return;
            if (event.code === 'ArrowLeft') {
                this.setSliceIndex(Utils.clamp(this.currentSlice - 1, 0, this.getSliceCount() - 1));
            } else if (event.code === 'ArrowRight') {
                this.setSliceIndex(Utils.clamp(this.currentSlice + 1, 0, this.getSliceCount() - 1));
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

    getMousePosInContainer(event) {
        const rect = this.ui.imageContainer.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        return {
            x: event.clientX - rect.left - width / 2,
            y: event.clientY - rect.top - height / 2
        };
    }

    mousePosToImageCoords(mousePos) {
        const { width, height } = this.getDimensions2D();
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        return {
            x: (mousePos.x - this.centerOffset.x) / this.scale + halfWidth,
            y: (mousePos.y - this.centerOffset.y) / this.scale + halfHeight,
        };

    }

    applyTransform() {
        if (!this.image) return;
        const { width, height } = this.getDimensions2D();
        this.canvas.style.transform = `translate(${this.centerOffset.x - width / 2}px, ${this.centerOffset.y - height / 2}px) scale(${this.scale})`;
    }

    setImage(image) {
        super.setImage(image);
        this.sliceIndexCache = {};
        this.updateSliceSlider();
        this.applyTransform();
    }

    centerAndScale() {
        if (!this.image) return;
        const { width, height } = this.getDimensions2D();
        // Get width and height of the container
        const containerRect = this.ui.imageContainer.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerHeight = containerRect.height - 40;

        // Calculate scale based on the container size
        this.scale = Math.min(containerWidth / width, containerHeight / height);


        this.centerOffset = { x: 0, y: -30 * this.scale }; // Center the image vertically

        this.applyTransform();
    }

    async render() {
        if (!this.image) return;

        const { width, height } = this.getDimensions2D();
        const { cachedWidth, cachedHeight } = this.renderCache;

        if (cachedWidth !== width || cachedHeight !== height) {
            this.centerAndScale();
        }

        const rerendered = await super.render();
        if (rerendered) {
            this.ui.sliceIndexDisplay.textContent = `${this.sliceDirection}=${this.currentSlice + 1}/${this.getSliceCount()}`;
        }
    }

    updateSliceSlider() {
        if (!this.image) throw new Error("Image not set");

        this.ui.sliceSlider.max = this.getSliceCount() - 1;
        this.ui.sliceSlider.value = this.currentSlice;
    }

    setSliceIndex(index, noSliderUpdate = false) {
        super.setSliceIndex(index);
        if (!noSliderUpdate)
            this.updateSliceSlider();
    }

    setSliceDirection(direction) {
        const oldSliceIndex = this.currentSlice;
        const oldDirection = this.sliceDirection;

        super.setSliceDirection(direction);

        this.sliceIndexCache[oldDirection] = oldSliceIndex;
        const newSliceIndex = Utils.clamp(this.sliceIndexCache[direction] || 0, 0, this.getSliceCount() - 1);
        this.setSliceIndex(newSliceIndex);

        this.updateSliceSlider();
    }

    destroy() {
        this.ui.container.remove();
        this.ui = {};

        super.destroy();
    }

}