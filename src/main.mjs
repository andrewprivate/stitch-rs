import { Controller } from "./ui/Controller.mjs";

window.controller = new Controller();
const element = window.controller.getElement();
document.body.appendChild(element); // Append the controller's UI to the body

element.style.width = '100%'; // Set the width of the controller's UI
element.style.height = '100%'; // Set the height of the controller's UI
