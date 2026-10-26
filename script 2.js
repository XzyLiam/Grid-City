(function () {
  'use strict';

  // ---------- Settings ----------
  var ROOM_HALF = 25;      // room is 50 x 50 units wide
  var ROOM_HEIGHT = 20;    // floor to ceiling
  var CELL = 1;            // size of one grid square
  var EYE_HEIGHT = 1.7;
  var MOVE_SPEED = 6;      // units per second
  var MOUSE_SENS = 0.0022;
  var TOUCH_SENS = 0.005;
  var LINE_COLOR = 0x222222;

  var isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  // ---------- Scene ----------
  var canvas = document.getElementById('scene');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.fog = new THREE.Fog(0xffffff, 8, 48); // distant lines fade into white

  var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, EYE_HEIGHT, 0);

  var lineMaterial = new THREE.LineBasicMaterial({ color: LINE_COLOR });

  // Builds a flat grid of lines in the XY plane, centred on the origin.
  function makeGridPlane(width, height) {
    var pts = [];
    var x, y;
    for (x = -width / 2; x <= width / 2 + 1e-6; x += CELL) {
      pts.push(x, -height / 2, 0, x, height / 2, 0);
    }
    for (y = -height / 2; y <= height / 2 + 1e-6; y += CELL) {
      pts.push(-width / 2, y, 0, width / 2, y, 0);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, lineMaterial);
  }

  var W = ROOM_HALF * 2;
  var H = ROOM_HEIGHT;

  // Floor
  var floor = makeGridPlane(W, W);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Ceiling
  var ceiling = makeGridPlane(W, W);
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = H;
  scene.add(ceiling);

  // Four walls
  var wallN = makeGridPlane(W, H);
  wallN.position.set(0, H / 2, -ROOM_HALF);
  scene.add(wallN);

  var wallS = makeGridPlane(W, H);
  wallS.position.set(0, H / 2, ROOM_HALF);
  scene.add(wallS);

  var wallE = makeGridPlane(W, H);
  wallE.rotation.y = Math.PI / 2;
  wallE.position.set(ROOM_HALF, H / 2, 0);
  scene.add(wallE);

  var wallW = makeGridPlane(W, H);
  wallW.rotation.y = Math.PI / 2;
  wallW.position.set(-ROOM_HALF, H / 2, 0);
  scene.add(wallW);

  // A few floating grid panels so there is something to walk around
  var panels = [
    { x: -6,  y: 5,  z: -10, ry: 0.3,  w: 10, h: 8 },
    { x: 8,   y: 4,  z: -4,  ry: -0.9, w: 12, h: 8 },
    { x: -2,  y: 7,  z: 9,   ry: 1.4,  w: 10, h: 10 },
    { x: 12,  y: 6,  z: 12,  ry: 0.1,  w: 8,  h: 8 }
  ];
  panels.forEach(function (p) {
    var m = makeGridPlane(p.w, p.h);
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.ry;
    scene.add(m);
  });

  // ---------- Look + move state ----------
  var yaw = 0;
  var pitch = 0;
  var keys = {};
  var joy = { x: 0, y: 0 };   // -1..1, y negative = forward

  function applyLook() {
    var limit = Math.PI / 2 - 0.01;
    pitch = Math.max(-limit, Math.min(limit, pitch));
    camera.rotation.set(pitch, yaw, 0);
  }

  // ---------- Desktop: pointer lock + keyboard ----------
  var intro = document.getElementById('intro');

  intro.addEventListener('click', function () {
    if (isTouch) {
      intro.classList.add('hidden');
    } else {
      canvas.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', function () {
    var locked = document.pointerLockElement === canvas;
    intro.classList.toggle('hidden', locked);
    if (!locked) keys = {};
  });

  document.addEventListener('mousemove', function (e) {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    applyLook();
  });

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });

  // ---------- Touch: joystick (left) + look (right) ----------
  var joystickEl = document.getElementById('joystick');
  var stickEl = document.getElementById('stick');
  var joyId = null;
  var joyCenter = { x: 0, y: 0 };
  var JOY_RADIUS = 48;

  var lookId = null;
  var lastLook = { x: 0, y: 0 };

  function setStick(dx, dy) {
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    stickEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    joy.x = dx / JOY_RADIUS;
    joy.y = dy / JOY_RADIUS;
  }

  function resetStick() {
    stickEl.style.transform = 'translate(0,0)';
    joy.x = 0;
    joy.y = 0;
  }

  function touchById(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }

  window.addEventListener('touchstart', function (e) {
    if (!isTouch) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var rect = joystickEl.getBoundingClientRect();
      var onJoystick =
        t.clientX >= rect.left - 20 && t.clientX <= rect.right + 20 &&
        t.clientY >= rect.top - 20 && t.clientY <= rect.bottom + 20;

      if (onJoystick && joyId === null) {
        joyId = t.identifier;
        joyCenter.x = rect.left + rect.width / 2;
        joyCenter.y = rect.top + rect.height / 2;
        setStick(t.clientX - joyCenter.x, t.clientY - joyCenter.y);
      } else if (!onJoystick && lookId === null && t.clientX > window.innerWidth * 0.35) {
        lookId = t.identifier;
        lastLook.x = t.clientX;
        lastLook.y = t.clientY;
      }
    }
  }, { passive: false });

  window.addEventListener('touchmove', function (e) {
    if (!isTouch) return;
    e.preventDefault();
    var tj = touchById(e.touches, joyId);
    if (joyId !== null && tj) {
      setStick(tj.clientX - joyCenter.x, tj.clientY - joyCenter.y);
    }
    var tl = touchById(e.touches, lookId);
    if (lookId !== null && tl) {
      yaw -= (tl.clientX - lastLook.x) * TOUCH_SENS;
      pitch -= (tl.clientY - lastLook.y) * TOUCH_SENS;
      lastLook.x = tl.clientX;
      lastLook.y = tl.clientY;
      applyLook();
    }
  }, { passive: false });

  function endTouch(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var id = e.changedTouches[i].identifier;
      if (id === joyId) { joyId = null; resetStick(); }
      if (id === lookId) { lookId = null; }
    }
  }
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);

  // ---------- Resize ----------
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- Game loop ----------
  var clock = new THREE.Clock();
  var forward = new THREE.Vector3();
  var right = new THREE.Vector3();
  var margin = 0.4;

  function update(dt) {
    var f = 0, s = 0, v = 0;

    if (keys['KeyW'] || keys['ArrowUp'])    f += 1;
    if (keys['KeyS'] || keys['ArrowDown'])  f -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) s += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  s -= 1;
    if (keys['Space']) v += 1;
    if (keys['ShiftLeft'] || keys['ShiftRight']) v -= 1;

    // joystick: up on the stick = forward
    f += -joy.y;
    s += joy.x;

    // keep diagonal speed from exceeding walking speed
    var len = Math.sqrt(f * f + s * s);
    if (len > 1) { f /= len; s /= len; }

    // move along the horizontal direction the camera faces
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    camera.position.addScaledVector(forward, f * MOVE_SPEED * dt);
    camera.position.addScaledVector(right, s * MOVE_SPEED * dt);
    camera.position.y += v * MOVE_SPEED * dt;

    // stay inside the room
    var lim = ROOM_HALF - margin;
    camera.position.x = Math.max(-lim, Math.min(lim, camera.position.x));
    camera.position.z = Math.max(-lim, Math.min(lim, camera.position.z));
    camera.position.y = Math.max(0.3, Math.min(H - 0.3, camera.position.y));
  }

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    renderer.render(scene, camera);
  }

  applyLook();
  animate();
})();
