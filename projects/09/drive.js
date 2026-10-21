// Arcade car handling: a bicycle model for yaw plus a lateral grip term, so the car can slide a
// little (and a lot with the handbrake). Units are metres and seconds. Car space: nose is +Z,
// +X is the car's left, yaw turns +Z toward +X.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export const TUNING = {
    maxSpeed: 42,        // m/s: where the engine runs out; drag holds the car to about 136 km/h
    accel: 8,            // m/s² from a standstill, fading toward max speed: 0-100 in about 5.6 s
    brake: 18,
    reverseMax: 7,
    reverseAccel: 4.5,
    roll: 0.35,          // rolling resistance in m/s²: light, so the car coasts
    air: 0.0009,         // air drag, scales with v²
    maxSteer: 0.6,       // radians at the front wheels, at low speed
    steerFalloff: 18,    // speed (m/s) at which the steering lock has halved
    steerRate: 3.2,      // how fast keyboard steering winds on (rad/s)
    maxLat: 11,          // m/s² of cornering the tyres allow: caps the turn rate at speed
    grip: 9,             // how quickly sideways sliding dies out
    driftGrip: 1.6,      // grip with the handbrake held
};

export function createDrive() {
    return {
        x: 0, z: 0, yaw: 0,
        vx: 0, vz: 0,
        speed: 0,        // forward speed (negative when reversing)
        slip: 0,         // sideways speed
        steer: 0,        // current front-wheel angle (positive = left)
        yawRate: 0,
        accLong: 0,      // for body pitch
        accLat: 0,       // for body roll
        grade: 0,        // slope along the car (set by the game from the ground)
    };
}

export function placeDrive(d, x, z, yaw) {
    Object.assign(d, { x, z, yaw, vx: 0, vz: 0, speed: 0, slip: 0, steer: 0, yawRate: 0, accLong: 0, accLat: 0, grade: 0 });
}

// input: { throttle 0..1, brake 0..1, steer -1..1 (right +), handbrake, analog }
export function stepDrive(d, input, dt, wheelbase, T = TUNING) {
    let sin = Math.sin(d.yaw), cos = Math.cos(d.yaw);
    const before = d.vx * sin + d.vz * cos;     // forward speed at the start of the step

    // pedals: the brake key reverses once stopped, the gas key brakes while rolling backwards
    let a = 0;
    if (input.throttle > 0) {
        if (before < -0.5) a += T.brake * input.throttle;
        else a += T.accel * input.throttle * clamp(1 - before / T.maxSpeed, 0, 1) ** 0.7;
    }
    if (input.brake > 0) {
        if (before > 0.5) a -= T.brake * input.brake;
        else a -= T.reverseAccel * input.brake * clamp(1 + before / T.reverseMax, 0, 1);
    }
    if (input.handbrake) a -= Math.sign(before) * Math.min(Math.abs(before) / dt, 9);
    a -= Math.sign(before) * T.roll + before * Math.abs(before) * T.air;
    a -= 9.81 * (d.grade || 0);   // hills: grade is the sine of the slope under the car, nose up +

    // steering: less lock at speed; keys ease in, sticks are direct
    const lock = T.maxSteer / (1 + Math.abs(before) / T.steerFalloff);
    const target = -input.steer * lock;
    if (input.analog) d.steer += (target - d.steer) * damp(18, dt);
    else d.steer += clamp(target - d.steer, -T.steerRate * dt, T.steerRate * dt);

    // geometry says how tight the wheels point; grip says how tight the car can actually go
    const lat = T.maxLat * (input.handbrake ? 1.7 : 1);   // the tail swings out a bit further
    const cap = lat / Math.max(Math.abs(before), 1);
    d.yawRate = clamp((before * Math.tan(d.steer)) / wheelbase, -cap, cap);
    d.yaw += d.yawRate * dt;

    // The car has turned but its momentum hasn't: split the old velocity along the new heading.
    // The sideways part is the slide; tyre grip wears it down (much less with the handbrake).
    sin = Math.sin(d.yaw);
    cos = Math.cos(d.yaw);
    let vF = d.vx * sin + d.vz * cos;
    let vS = d.vx * cos - d.vz * sin;
    const next = vF + a * dt;
    // resistance alone must not push the car through zero and back
    vF = !input.throttle && !input.brake && vF !== 0 && Math.sign(next) !== Math.sign(vF) ? 0 : next;
    vS *= 1 - damp(input.handbrake ? T.driftGrip : T.grip, dt);

    d.vx = vF * sin + vS * cos;
    d.vz = vF * cos - vS * sin;
    d.x += d.vx * dt;
    d.z += d.vz * dt;

    d.speed = vF;
    d.slip = vS;
    d.accLong = (vF - before) / dt;
    d.accLat = vF * d.yawRate;
}
