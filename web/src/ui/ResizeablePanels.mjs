import { EventEmitter } from "../modules/EventEmitter.mjs";
import { RangeSet } from "../modules/RangeTools.mjs";
import { Utils } from "../utils/Utils.mjs";

export class Panel extends EventEmitter {
    constructor() {
        super();
        this.bounds = {
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0
        }

        this.setupUI();
    }

    isTouching(otherPanel) {
        return !(
            this.bounds.maxX <= otherPanel.bounds.minX ||
            this.bounds.minX >= otherPanel.bounds.maxX ||
            this.bounds.maxY <= otherPanel.bounds.minY ||
            this.bounds.minY >= otherPanel.bounds.maxY
        );
    }

    setupUI() {
        this.ui = {};
        this.ui.panel = document.createElement('div');
        this.ui.panel.classList.add('panel');
    }

    updateUI() {
        this.ui.panel.style.left = `${this.bounds.minX * 100}%`;
        this.ui.panel.style.top = `${this.bounds.minY * 100}%`;
        this.ui.panel.style.width = `${(this.bounds.maxX - this.bounds.minX) * 100}%`;
        this.ui.panel.style.height = `${(this.bounds.maxY - this.bounds.minY) * 100}%`;
    }

    setBounds(minX, minY, maxX, maxY) {
        
        this.bounds.minX = Utils.clamp(minX, 0, 1);
        this.bounds.minY = Utils.clamp(minY, 0, 1);
        this.bounds.maxX = Utils.clamp(maxX, this.bounds.minX, 1);
        this.bounds.maxY = Utils.clamp(maxY, this.bounds.minY, 1);

        this.updateUI();
    }

    getElement() {
        return this.ui.panel;
    }
}

export class ResizeablePanels {
    constructor() {
        this.panels = [];
        this.boundariesX = [];
        this.boundariesY = [];
        this.intersections = [];
        this.mergedBoundariesX = [];
        this.mergedBoundariesY = [];
        this.setupUI();
    }

    setupUI() {
        this.ui = {};
        this.ui.container = document.createElement('div');
        this.ui.container.classList.add('resizeable-panels');
    }

    getElement() {
        return this.ui.container;
    }

    setPanels(panels) {
        this.panels = [];
        this.ui.container.replaceChildren(); // Clear existing panels
        panels.forEach(panel => {
            this.panels.push(panel);
            this.ui.container.appendChild(panel.getElement());
        });
        this.refreshPanelBoundaries();
    }

    refreshPanelBoundaries() {
        // Reset boundary elements
        ([this.boundariesX, this.boundariesY, this.mergedBoundariesX, this.mergedBoundariesY, this.intersections]).forEach(boundaries => {
            boundaries.forEach(b => {
                if (b.element) {
                    b.element.remove();
                }
                if (b.knob) {
                    b.knob.remove();
                }
            }); 
        });


        const boundariesX = [];
        const boundariesY = [];
        for (let i = 0; i < this.panels.length; i++) {
            for (let j = i + 1; j < this.panels.length; j++) {
                const bounds1 = this.panels[i].bounds;
                const bounds2 = this.panels[j].bounds;

                const startX = Math.max(bounds1.minX, bounds2.minX);
                const endX = Math.min(bounds1.maxX, bounds2.maxX);
                const startY = Math.max(bounds1.minY, bounds2.minY);
                const endY = Math.min(bounds1.maxY, bounds2.maxY);

                const matchX = bounds1.maxX === bounds2.minX || bounds1.minX === bounds2.maxX;
                const matchY = bounds1.maxY === bounds2.minY || bounds1.minY === bounds2.maxY;

                if (matchX && startY < endY) {
                    const panelLess = bounds1.minX < bounds2.minX ? this.panels[i] : this.panels[j];
                    const panelMore = bounds1.minX < bounds2.minX ? this.panels[j] : this.panels[i];
                    boundariesX.push({
                        isX: true,
                        pos: startX,
                        panelsLess: new Set([panelLess]),
                        panelsMore: new Set([panelMore]),
                        start: startY,
                        end: endY,
                        canMoveStart: bounds1.minY === bounds2.minY,
                        canMoveEnd: bounds1.maxY === bounds2.maxY,
                    });
                } else if (matchY && startX < endX) {
                    const panelLess = bounds1.minY < bounds2.minY ? this.panels[i] : this.panels[j];
                    const panelMore = bounds1.minY < bounds2.minY ? this.panels[j] : this.panels[i];
                    boundariesY.push({
                        isX: false,
                        pos: startY,
                        panelsLess: new Set([panelLess]),
                        panelsMore: new Set([panelMore]),
                        start: startX,
                        end: endX,
                        canMoveStart: bounds1.minX === bounds2.minX,
                        canMoveEnd: bounds1.maxX === bounds2.maxX,
                    });
                }
            }
        }


        // Sort boundaries
        ([boundariesX, boundariesY]).forEach(boundaries => {
            boundaries.sort((a, b) => {
                if (a.pos === b.pos) {
                    return a.start - b.start;
                }
                return a.pos - b.pos;
            });
        });

        // Go through boundaries and make sure movement is possible
        ([boundariesX, boundariesY]).forEach(boundaries => {
            for (let i = 0; i < boundaries.length; i++) {
                const boundary = boundaries[i];
                if (boundary.canMoveStart && !boundary.canMoveEnd) {
                    // Find the next boundary with the same x that can move
                    let nextBoundaryIndex = -1;
                    let lastEnd = boundary.end;
                    for (let j = i + 1; j < boundaries.length; j++) {
                        // Check if the next boundary has the same x
                        if (boundaries[j].pos !== boundary.pos) {
                            break;
                        }

                        // Check if the next boundary continues from the last end
                        if (lastEnd !== boundaries[j].start) {
                            break;
                        }

                        lastEnd = boundaries[j].end;

                        // Check if it can move
                        if (boundaries[j].canMoveEnd) {
                            nextBoundaryIndex = j;
                            break;
                        }
                    }

                    if (nextBoundaryIndex !== -1) {
                        // Combine the next boundaries until we reach a boundary that can move
                        for (let j = i; j <= nextBoundaryIndex; j++) {
                            boundaries[j].panelsLess.forEach(panel => {
                                boundary.panelsLess.add(panel);
                            });

                            boundaries[j].panelsMore.forEach(panel => {
                                boundary.panelsMore.add(panel);
                            });
                        }

                        // Set the new endY
                        boundary.end = lastEnd;
                        boundary.canMoveEnd = true;

                        // Remove the next boundaries
                        boundaries.splice(i + 1, nextBoundaryIndex - i);
                    }
                }

                // Remove if cannot move
                if (!boundary.canMoveStart && !boundary.canMoveEnd) {
                    boundaries.splice(i, 1);
                    i--;
                }
            }
        });

        // Go through boundaries to find flat intersections
        const [mergedBoundariesX, mergedBoundariesY] = ([boundariesX, boundariesY]).map((boundaries, isX) => {
            isX = isX === 0;
            const mergedBoundaries = [];
            const currentRun = [];

            for (let i = 0; i < boundaries.length; i++) {
                const boundary = boundaries[i];

                if (currentRun.length === 0) {
                    currentRun.push(boundary);
                } else {
                    const lastBoundary = currentRun[currentRun.length - 1];

                    if (lastBoundary.end === boundary.start && lastBoundary.pos === boundary.pos) {
                        currentRun.push(boundary);
                    } else {
                        if (currentRun.length > 0) {
                            mergedBoundaries.push({
                                isX,
                                pos: lastBoundary.pos,
                                start: currentRun[0].start,
                                end: lastBoundary.end,
                                panelsLess: new Set(currentRun.flatMap(b => Array.from(b.panelsLess))),
                                panelsMore: new Set(currentRun.flatMap(b => Array.from(b.panelsMore))),
                                boundaries: currentRun.slice(),
                            });
                        }
                        currentRun.length = 0;
                        currentRun.push(boundary);
                    }
                }
            }

            if (currentRun.length > 0) {
                mergedBoundaries.push({
                    isX,
                    pos: currentRun[0].pos,
                    start: currentRun[0].start,
                    end: currentRun[currentRun.length - 1].end,
                    panelsLess: new Set(currentRun.flatMap(b => Array.from(b.panelsLess))),
                    panelsMore: new Set(currentRun.flatMap(b => Array.from(b.panelsMore))),
                    boundaries: currentRun.slice()
                });
            }

            return mergedBoundaries;
        });

        // Find 2d intersections
        const intersections = [];
        mergedBoundariesX.forEach(xBoundary => {
            mergedBoundariesY.forEach(yBoundary => {
                const xStartY = xBoundary.start;
                const xEndY = xBoundary.end;
                const xPos = xBoundary.pos;
                const yStartX = yBoundary.start;
                const yEndX = yBoundary.end;
                const yPos = yBoundary.pos;

                const xValid = yStartX <= xPos && xPos <= yEndX;
                const yValid = xStartY <= yPos && yPos <= xEndY;

                if (xValid && yValid) {
                    // Find intersection with x and y
                    const intersection = intersections.find(i => i.x === xPos && i.y === yPos);
                    if (!intersection) {
                        intersections.push({
                            x: xPos,
                            y: yPos,
                            mergedBoundaries: new Set([xBoundary, yBoundary]),
                        });
                    } else {
                        intersection.mergedBoundaries.add(xBoundary);
                        intersection.mergedBoundaries.add(yBoundary);
                    }
                }
            });
        });


        this.intersections = intersections;
        this.mergedBoundariesX = mergedBoundariesX;
        this.mergedBoundariesY = mergedBoundariesY;
        this.boundariesX = boundariesX;
        this.boundariesY = boundariesY;

        // First create merged boundaries
        this.mergedBoundariesX.forEach(boundary => {
            this.createBoundaryElements(boundary, true);
        });

        this.mergedBoundariesY.forEach(boundary => {
            this.createBoundaryElements(boundary, false);
        });

        // Create intersections
        this.intersections.forEach(intersection => {
            const knob = document.createElement('div');
            knob.classList.add('intersection-xy-knob');
            knob.style.left = `${intersection.x * 100}%`;
            knob.style.top = `${intersection.y * 100}%`;
            this.ui.container.appendChild(knob);
            intersection.knob = knob;

            knob.addEventListener('mouseenter', () => {
                if (this.movingBoundary) return;
                intersection.mergedBoundaries.forEach(mergedBoundary => {
                    mergedBoundary.boundaries.forEach(boundary => {
                        boundary.element.classList.add('hover-intersection');
                    });
                });
            });

            knob.addEventListener('mouseleave', () => {
                if (this.movingBoundary) return;
                intersection.mergedBoundaries.forEach(mergedBoundary => {
                    mergedBoundary.boundaries.forEach(boundary => {
                        boundary.element.classList.remove('hover-intersection');
                    });
                });
            });

            let startClientX = 0;
            let startClientY = 0;
            let startX = 0;
            let startY = 0;

            let mouseMoveHandler, mouseUpHandler, mouseDownHandler;

            mouseMoveHandler = (event) => {
                const deltaX = event.clientX - startClientX;
                const deltaY = event.clientY - startClientY;

                const newX = Utils.clamp(startX + deltaX / this.ui.container.clientWidth, 0, 1);
                const newY = Utils.clamp(startY + deltaY / this.ui.container.clientHeight, 0, 1);

                let oldX = intersection.x;
                let oldY = intersection.y;

                intersection.x = newX;
                intersection.y = newY;

                knob.style.left = `${newX * 100}%`;
                knob.style.top = `${newY * 100}%`;

                intersection.mergedBoundaries.forEach(mergedBoundary => {
                    const isX = mergedBoundary.isX;
                    if (isX) {
                        mergedBoundary.pos = newX;
                    } else {
                        mergedBoundary.pos = newY;
                    }
                    mergedBoundary.boundaries.forEach(boundary => {
                        if (boundary.isX) {
                            boundary.pos = newX;
                            if (boundary.start === oldY) {
                                boundary.start = newY;
                            } else if (boundary.end === oldY) {
                                boundary.end = newY;
                            }
                        } else {
                            boundary.pos = newY;
                            if (boundary.start === oldX) {
                                boundary.start = newX;
                            } else if (boundary.end === oldX) {
                                boundary.end = newX;
                            }
                        }

                        this.updateBoundaryPosition(boundary.element, boundary.pos, boundary.start, boundary.end, boundary.isX);
                    });

                    this.updatePanels(mergedBoundary);
                });

            }

            mouseUpHandler = (event) => {
                this.movingBoundary = null;
                window.removeEventListener('mousemove', mouseMoveHandler);
                window.removeEventListener('mouseup', mouseUpHandler);
                this.refreshPanelBoundaries();
            }

            mouseDownHandler = (event) => {
                this.movingBoundary = intersection;
                window.addEventListener('mousemove', mouseMoveHandler);
                window.addEventListener('mouseup', mouseUpHandler);

                startClientX = event.clientX;
                startClientY = event.clientY;
                startX = intersection.x;
                startY = intersection.y;
            }

            knob.addEventListener('mousedown', mouseDownHandler);
        });
 
    }

    updateBoundaryPosition(element, pos, start, end, isX, size = 1) {
        const elementSpan = end - start;
        const elementSize = size * elementSpan;
        const elementMargin = (1 - size) * elementSpan / 2;

        const elementStart = `${(start + elementMargin) * 100}%`;
        const elementEnd = `${elementSize * 100}%`;
        const elementPos = `${pos * 100}%`;

        if (isX) {
            element.style.top = elementStart;
            element.style.height = elementEnd;
            element.style.left = elementPos;
        } else {
            element.style.left = elementStart;
            element.style.width = elementEnd;
            element.style.top = elementPos;
        }
    }

    updatePanels(boundary) {
        const newPos = boundary.pos;
        const isX = boundary.isX;
        boundary.panelsLess.forEach(panel => {
            if (isX) {
                panel.setBounds(panel.bounds.minX, panel.bounds.minY, newPos, panel.bounds.maxY);
            } else {
                panel.setBounds(panel.bounds.minX, panel.bounds.minY, panel.bounds.maxX, newPos);
            }
        });

        boundary.panelsMore.forEach(panel => {
            if (isX) {
                panel.setBounds(newPos, panel.bounds.minY, panel.bounds.maxX, panel.bounds.maxY);
            } else {
                panel.setBounds(panel.bounds.minX, newPos, panel.bounds.maxX, panel.bounds.maxY);
            }
        });
    }

    createBoundaryElements(mergedBoundary) {
        const isX = mergedBoundary.isX;

        mergedBoundary.boundaries.forEach(boundary => {
            boundary.element = document.createElement('div');
            boundary.element.classList.add(isX ? 'boundary-x' : 'boundary-y');
            this.updateBoundaryPosition(boundary.element, boundary.pos, boundary.start, boundary.end, isX);
            this.ui.container.appendChild(boundary.element);
        });

        const knob = document.createElement('div');
        knob.classList.add(isX ? 'merged-boundary-x-knob' : 'merged-boundary-y-knob');
        this.updateBoundaryPosition(knob, mergedBoundary.pos, mergedBoundary.start, mergedBoundary.end, isX);
        this.ui.container.appendChild(knob);

        knob.addEventListener('mouseenter', () => {
            if (this.movingBoundary) return;
            mergedBoundary.boundaries.forEach(boundary => {
                boundary.element.classList.add('hover-intersection');
            });
        });

        knob.addEventListener('mouseleave', () => {
            if (this.movingBoundary) return;
            mergedBoundary.boundaries.forEach(boundary => {
                boundary.element.classList.remove('hover-intersection');
            });
        });
        
        
        let mouseMoveHandler, mouseUpHandler, mouseDownHandler;

        let startClientX = 0;
        let startPos = 0;

        mouseMoveHandler = (event) => {
            const delta = (isX ? event.clientX : event.clientY) - startClientX;
            const newPos = Utils.clamp(startPos + delta / (isX ? this.ui.container.clientWidth : this.ui.container.clientHeight), 0, 1);
            mergedBoundary.pos = newPos;
            this.updateBoundaryPosition(knob, newPos, mergedBoundary.start, mergedBoundary.end, isX);
            mergedBoundary.boundaries.forEach(boundary => {
                boundary.pos = newPos;
                this.updateBoundaryPosition(boundary.element, boundary.pos, boundary.start, boundary.end, isX);
            });
            this.updatePanels(mergedBoundary);
        }

        mouseUpHandler = (event) => {
            this.movingBoundary = null;
            window.removeEventListener('mousemove', mouseMoveHandler);
            window.removeEventListener('mouseup', mouseUpHandler);

            this.refreshPanelBoundaries();
        }

        mouseDownHandler = (event) => {
            this.movingBoundary = mergedBoundary;
            window.addEventListener('mousemove', mouseMoveHandler);
            window.addEventListener('mouseup', mouseUpHandler);

            startClientX = isX ? event.clientX : event.clientY;
            startPos = mergedBoundary.pos;
        }

        knob.addEventListener('mousedown', mouseDownHandler);

        if (mergedBoundary.boundaries.length > 1) {
            mergedBoundary.boundaries.forEach(boundary => {
                const knob = document.createElement('div');
                knob.classList.add(isX ? 'boundary-x-knob' : 'boundary-y-knob');
                const knobSize = 0.20;
                this.updateBoundaryPosition(knob, boundary.pos, boundary.start, boundary.end, isX, knobSize);
                this.ui.container.appendChild(knob);
                boundary.knob = knob;

                knob.addEventListener('mouseenter', () => {
                    if (this.movingBoundary) return;
                    boundary.element.classList.add('hover-boundary');
                });

                knob.addEventListener('mouseleave', () => {
                    if (this.movingBoundary) return;
                    boundary.element.classList.remove('hover-boundary');
                });

                let startClientX = 0;
                let startPos = 0;

                let mouseMoveHandler, mouseUpHandler, mouseDownHandler;
                mouseMoveHandler = (event) => {
                    const delta = (isX ? event.clientX : event.clientY) - startClientX;
                    const newPos = Utils.clamp(startPos + delta / (isX ? this.ui.container.clientWidth : this.ui.container.clientHeight), 0, 1);
                    boundary.pos = newPos;
                    this.updateBoundaryPosition(knob, newPos, boundary.start, boundary.end, isX, knobSize);
                    this.updateBoundaryPosition(boundary.element, boundary.pos, boundary.start, boundary.end, isX);
                    this.updatePanels(boundary);
                }

                mouseUpHandler = (event) => {
                    window.removeEventListener('mousemove', mouseMoveHandler);
                    window.removeEventListener('mouseup', mouseUpHandler);
                    this.movingBoundary = null;
                    this.refreshPanelBoundaries();
                }

                mouseDownHandler = (event) => {
                    this.movingBoundary = boundary;
                    window.addEventListener('mousemove', mouseMoveHandler);
                    window.addEventListener('mouseup', mouseUpHandler);

                    startClientX = isX ? event.clientX : event.clientY;
                    startPos = boundary.pos;
                }

                knob.addEventListener('mousedown', mouseDownHandler);
            });
        }
    }

}