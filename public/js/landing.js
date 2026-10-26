import { firstPage } from './device.js';
import { wakeBackend } from './upload.js';

// Skip the steps this device has already finished.
document.getElementById('begin').href = firstPage();
wakeBackend();
