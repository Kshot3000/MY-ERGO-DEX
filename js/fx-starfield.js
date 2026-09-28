/* ============================================================
   AstroErg starfield — animated deep-space background.
   Twinkling stars, slow parallax drift, occasional shooting stars.
   Pure canvas, no assets. Respects prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("starfield");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, stars = [], shooters = [], t = 0;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    stars = [];
    var n = Math.min(420, Math.floor((W * H) / 4200));
    var hues = [200, 210, 220, 265, 190]; // icy blues → violet
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.6 + 0.3,
        hue: hues[(Math.random() * hues.length) | 0],
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.4,   // twinkle speed
        drift: 0.02 + Math.random() * 0.10, // px/frame parallax
        depth: 0.3 + Math.random() * 0.7,
      });
    }
  }

  function spawnShooter() {
    // streak from a random top-ish point, diagonal
    var x = Math.random() * W * 0.8 + W * 0.1;
    shooters.push({
      x: x, y: Math.random() * H * 0.35,
      vx: -(6 + Math.random() * 5), vy: 3 + Math.random() * 2.5,
      life: 1,
    });
  }

  function frame() {
    t += 0.016;
    ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.x -= s.drift * s.depth;
      if (s.x < -4) { s.x = W + 4; s.y = Math.random() * H; }
      var tw = 0.45 + 0.55 * Math.sin(t * s.speed + s.phase);
      var a = (0.25 + 0.75 * s.depth) * tw;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = "hsla(" + s.hue + ", 90%, 82%," + a.toFixed(3) + ")";
      ctx.fill();
      // cross sparkle on the brightest few
      if (s.r > 1.5 && tw > 0.85) {
        ctx.strokeStyle = "hsla(" + s.hue + ", 90%, 85%," + (a * 0.5).toFixed(3) + ")";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 3, s.y); ctx.lineTo(s.x + s.r * 3, s.y);
        ctx.moveTo(s.x, s.y - s.r * 3); ctx.lineTo(s.x, s.y + s.r * 3);
        ctx.stroke();
      }
    }

    if (!reduced && Math.random() < 0.006 && shooters.length < 3) spawnShooter();
    for (var j = shooters.length - 1; j >= 0; j--) {
      var sh = shooters[j];
      sh.x += sh.vx; sh.y += sh.vy; sh.life -= 0.016;
      if (sh.life <= 0 || sh.x < -80 || sh.y > H + 80) { shooters.splice(j, 1); continue; }
      var grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 12, sh.y - sh.vy * 12);
      grad.addColorStop(0, "rgba(180, 230, 255," + (0.9 * sh.life).toFixed(3) + ")");
      grad.addColorStop(1, "rgba(180, 230, 255, 0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(sh.x - sh.vx * 12, sh.y - sh.vy * 12);
      ctx.stroke();
    }

    if (!reduced) requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  if (reduced) {
    // single static frame for reduced-motion users
    frame();
  } else {
    requestAnimationFrame(frame);
  }
})();
