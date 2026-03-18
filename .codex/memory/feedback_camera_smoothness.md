# Feedback Memory: Camera Smoothness

Camera motion should use simple exponential smoothing.

Rules:

- Prefer `camera.position.lerp(goal, 0.045)` style smoothing
- No cinematic flight paths
- No FOV warp
- No camera roll
- Cancel or yield cleanly on user interaction
- Do not disable and re-enable controls as a transition trick

The camera should feel buttery, not theatrical.
