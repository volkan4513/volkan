// Driving input: keyboard, touch (floating steer stick + pedals, from project 08) and gamepad,
// merged into one { throttle, brake, steer, handbrake } every frame.
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

// actions: { pause, camera, nextCar, prevCar, reset, pixel } — one-shot buttons/keys
export function createInput(actions) {
    const keys = new Set();
    const touch = { steer: 0, throttle: false, brake: false, handbrake: false };
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    let enabled = false;
    let touchMode = matchMedia('(pointer: coarse)').matches;

    // ---------- keyboard ----------
    const ONE_SHOT = { KeyC: 'camera', KeyE: 'nextCar', KeyQ: 'prevCar', KeyR: 'reset', KeyP: 'pixel', KeyT: 'wheelStyle' };
    addEventListener('keydown', (e) => {
        // Esc toggles pause, so it has to work while input is switched off too
        if (e.code === 'Escape' && !e.repeat) return void actions.pause?.();
        if (!enabled) return;
        if (DRIVE_KEYS.includes(e.code)) e.preventDefault();
        if (!e.repeat && ONE_SHOT[e.code]) actions[ONE_SHOT[e.code]]?.();
        keys.add(e.code);
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());

    // ---------- touch: left half is a floating stick (x only steers) ----------
    const touchLayer = $('touch'), stick = $('stick'), knob = $('knob');
    const STICK_R = 56;
    let stickId = null, stickX = 0, stickY = 0;

    function placeStickHome() {
        stick.style.left = `${Math.max(90, innerWidth * 0.14)}px`;
        stick.style.top = `${innerHeight - Math.max(90, innerHeight * 0.26)}px`;
    }

    touchLayer.addEventListener('pointerdown', (e) => {
        if (e.target !== touchLayer || stickId !== null || e.clientX > innerWidth * 0.5) return;
        touchLayer.setPointerCapture(e.pointerId);
        stickId = e.pointerId;
        stickX = e.clientX;
        stickY = e.clientY;
        stick.style.left = `${stickX}px`;
        stick.style.top = `${stickY}px`;
        stick.classList.add('on');
    });
    touchLayer.addEventListener('pointermove', (e) => {
        if (e.pointerId !== stickId) return;
        // the knob only slides sideways: it's a steering wheel, not a walk stick
        const dx = clamp(e.clientX - stickX, -STICK_R, STICK_R);
        knob.style.transform = `translate(${dx}px, 0)`;
        const v = dx / STICK_R, dead = 0.08;
        touch.steer = Math.abs(v) < dead ? 0 : Math.sign(v) * (Math.abs(v) - dead) / (1 - dead);
    });
    function endStick(e) {
        if (e.pointerId !== stickId) return;
        stickId = null;
        touch.steer = 0;
        knob.style.transform = '';
        stick.classList.remove('on');
        placeStickHome();
    }
    touchLayer.addEventListener('pointerup', endStick);
    touchLayer.addEventListener('pointercancel', endStick);

    function holdButton(el, field) {
        el.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            el.setPointerCapture(e.pointerId);
            el.classList.add('on');
            touch[field] = true;
        });
        const release = () => { el.classList.remove('on'); touch[field] = false; };
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
    }
    function tapButton(el, fn) {
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(); });
    }
    holdButton($('tGas'), 'throttle');
    holdButton($('tBrake'), 'brake');
    holdButton($('tDrift'), 'handbrake');
    tapButton($('tPause'), () => actions.pause?.());
    tapButton($('tCam'), () => actions.camera?.());
    tapButton($('tCar'), () => actions.nextCar?.());

    // Switch to touch controls the first time a finger touches the screen.
    addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' && !touchMode) {
            touchMode = true;
            actions.touchMode?.();
        }
    }, true);
    addEventListener('resize', placeStickHome);
    placeStickHome();

    // ---------- gamepad (standard mapping): left stick steers, RT gas, LT brake, A drift ----------
    const padPrev = [];
    function readPad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) {
            if (!p || p.mapping !== 'standard') continue;
            const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
            const pressed = (i) => { const now = b(i) > 0.5, was = padPrev[i]; padPrev[i] = now; return now && !was; };
            if (pressed(9)) actions.pause?.();
            if (enabled) {
                if (pressed(3)) actions.camera?.();
                if (pressed(5)) actions.nextCar?.();
                if (pressed(4)) actions.prevCar?.();
                if (pressed(8)) actions.reset?.();
            }
            const ax = p.axes[0] || 0;
            return { steer: Math.abs(ax) < 0.12 ? 0 : ax, throttle: b(7), brake: b(6), handbrake: b(0) > 0.5 };
        }
        return null;
    }

    function read() {
        const k = (c) => (keys.has(c) ? 1 : 0);
        const pad = readPad();
        if (!enabled) return input;
        input.throttle = Math.max(k('KeyW') || k('ArrowUp'), touch.throttle ? 1 : 0, pad ? pad.throttle : 0);
        input.brake = Math.max(k('KeyS') || k('ArrowDown'), touch.brake ? 1 : 0, pad ? pad.brake : 0);
        input.steer = clamp((k('KeyD') || k('ArrowRight')) - (k('KeyA') || k('ArrowLeft')) + touch.steer + (pad ? pad.steer : 0), -1, 1);
        input.handbrake = keys.has('Space') || touch.handbrake || !!(pad && pad.handbrake);
        // analog sources (stick, pad) steer directly; keys ease in (see drive.js)
        input.analog = touch.steer !== 0 || !!(pad && pad.steer !== 0);
        return input;
    }

    function reset() {
        keys.clear();
        stickId = null;
        Object.assign(touch, { steer: 0, throttle: false, brake: false, handbrake: false });
        Object.assign(input, { throttle: 0, brake: 0, steer: 0, handbrake: false, analog: false });
        knob.style.transform = '';
        stick.classList.remove('on');
        for (const b of touchLayer.querySelectorAll('.tbtn')) b.classList.remove('on');
        placeStickHome();
    }

    return {
        read,
        reset,
        get touchMode() { return touchMode; },
        setEnabled(on) { enabled = on; if (!on) reset(); },
    };
}
