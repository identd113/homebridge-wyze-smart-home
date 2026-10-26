"use strict";

const nodeCrypto = require("crypto");
const axios = require("axios");

const SNAPSHOT_CACHE_MS = 10_000;
// A picture fetched at startup stays "fresh" this long, so the first time the Home app
// opens a camera tile it gets an image at once instead of waiting for a capture.
const SNAPSHOT_PREFETCH_MS = 60_000;
// Pictures are taken one camera at a time, never several at once. Jobs wait here:
// motion refreshes first (oldest first), then regular refreshes and startup pictures.
const pictureQueue = [];
let pictureRunning = false;

function pumpPictureQueue() {
  if (pictureRunning) return;
  const job = pictureQueue.shift();
  if (!job) return;
  pictureRunning = true;
  job.run()
    .catch(() => {})
    .finally(() => {
      pictureRunning = false;
      job.resolve();
      pumpPictureQueue();
    });
}
// A motion-triggered refresh is skipped if the last picture is newer than this.
const MOTION_REFRESH_MIN_GAP_MS = 10_000;
const STREAM_START_TIMEOUT_MS = 60_000; // a start that has not settled by then no longer counts as active

class WyzeCameraStreamingDelegate {
  constructor(camera) {
    this.camera = camera;
    // sessionID (hex) → { localRtpPort, localAudioRtpPort, videoSsrc, audioSsrc,
    //                     targetAddress, videoPort, rtcpPort, srtpKey, srtpSalt,
    //                     audioPort, audioRtcpPort, audioSrtpKey, audioSrtpSalt,
    //                     streamHandle }
    this._sessions = new Map();
    this._snapshotCache = null; // { buffer, expiresAt }
    this._lastSnapshot = null; // last good picture, shown while a live stream is running
    this._snapshotInFlight = null; // shared by concurrent snapshot requests
  }

  // A stream is active only once it has started (or is starting). A session HomeKit
  // prepared but never started, or one left over after a failed start, must not
  // count, or snapshots would be blocked until Homebridge restarts.
  _streamActive() {
    for (const session of this._sessions.values()) {
      // A handle that reports itself dead (reconnecting gave up) is not streaming, even
      // when HomeKit never sent a STOP for it.
      if (session.streamHandle && session.streamHandle.isAlive?.() !== false) return true;
      if (session.starting && Date.now() - session.startingSince < STREAM_START_TIMEOUT_MS) return true;
    }
    return false;
  }

  // Stop every live stream (Homebridge is shutting down).
  stopAll() {
    for (const session of this._sessions.values()) {
      try { session.streamHandle?.stop(); } catch (_) { /* already stopped */ }
      session.streamHandle = null;
    }
    this._sessions.clear();
  }

  /**
   * Fetch one picture ahead of time so the first Home app request is answered from the
   * cache. Runs in the background, one camera at a time, and never throws: a camera
   * that is offline, switched off or already streaming is skipped.
   */
  prefetchSnapshot() {
    return this._enqueuePicture("startup", () => this._prefetchSnapshot());
  }

  /**
   * Queue one picture job for this camera and resolve when it has run (or been dropped).
   * A motion job goes ahead of the regular jobs and replaces any job this camera already
   * has waiting; any other job is dropped when this camera already has one waiting.
   */
  _enqueuePicture(reason, run) {
    return new Promise((resolve) => {
      const waiting = pictureQueue.filter((job) => job.delegate === this);
      if (reason === "motion") {
        if (waiting.some((job) => job.reason === "motion")) return resolve();
        for (const job of waiting) {
          pictureQueue.splice(pictureQueue.indexOf(job), 1);
          job.resolve();
        }
        let at = 0;
        while (at < pictureQueue.length && pictureQueue[at].reason === "motion") at += 1;
        pictureQueue.splice(at, 0, { delegate: this, reason, run, resolve });
      } else {
        if (waiting.length > 0) return resolve();
        pictureQueue.push({ delegate: this, reason, run, resolve });
      }
      pumpPictureQueue();
    });
  }

  async _prefetchSnapshot() {
    const cam = this.camera;
    const name = cam.display_name;
    if (cam.cameraOnline === false) return cam.plugin.log.debug?.(`[Camera] [Snapshot] Skipping startup picture for ${name}: offline`);
    if (cam.power_switch === 0) return cam.plugin.log.debug?.(`[Camera] [Snapshot] Skipping startup picture for ${name}: camera is off`);
    if (this._streamActive() || this._snapshotCache) return;
    try {
      if (!this._snapshotInFlight) {
        this._snapshotInFlight = this._fetchSnapshot().finally(() => {
          this._snapshotInFlight = null;
        });
      }
      const buffer = await this._snapshotInFlight;
      if (this._snapshotCache?.buffer === buffer) this._snapshotCache.expiresAt = Date.now() + SNAPSHOT_PREFETCH_MS;
      cam.plugin.log(`[Camera] [Snapshot] Startup picture ready for ${name} (${Math.round(buffer.length / 1024)} KB)`);
    } catch (err) {
      cam.plugin.log.warn?.(`[Camera] [Snapshot] Startup picture failed for ${name}: ${err.message}`);
    }
  }

  /**
   * Replace the cached picture with a new one. `reason` is "timer" (the regular
   * refresh) or "motion". Queued behind the other cameras (a motion refresh goes ahead
   * of them and replaces this camera's own waiting job), never throws, and skips a
   * camera that is offline, off or streaming.
   * `keepFreshMs` is how long the Home app is served this picture without a new capture.
   */
  refreshSnapshot (reason, keepFreshMs) {
    if (keepFreshMs) this._keepFreshMs = keepFreshMs
    return this._enqueuePicture(reason, () => this._refreshSnapshot(reason, this._keepFreshMs || SNAPSHOT_PREFETCH_MS))
  }

  async _refreshSnapshot (reason, keepFreshMs) {
    const cam = this.camera
    const name = cam.display_name
    if (cam.cameraOnline === false || cam.power_switch === 0 || this._streamActive()) return
    const age = this._lastRefreshAt ? Date.now() - this._lastRefreshAt : Infinity
    // A picture taken for motion resets this camera's regular timer: its next slot is
    // skipped when the picture is still younger than half a refresh interval.
    if (reason === 'timer' && age < keepFreshMs / 4) return
    if (reason === 'motion' && age < MOTION_REFRESH_MIN_GAP_MS) return
    try {
      if (!this._snapshotInFlight) {
        this._snapshotInFlight = this._fetchSnapshot().finally(() => {
          this._snapshotInFlight = null
        })
      }
      const buffer = await this._snapshotInFlight
      this._lastRefreshAt = Date.now()
      if (this._snapshotCache?.buffer === buffer) this._snapshotCache.expiresAt = Date.now() + keepFreshMs
      cam.plugin.log.debug?.(`[Camera] [Snapshot] Refreshed picture for ${name} (${reason}, ${Math.round(buffer.length / 1024)} KB)`)
    } catch (err) {
      cam.plugin.log.debug?.(`[Camera] [Snapshot] Refresh failed for ${name} (${reason}): ${err.message}`)
    }
  }

  async handleSnapshotRequest(request, callback) {
    // Skip the slow live-capture fallback if we already know the camera is
    // offline — otherwise HomeKit waits for the full WebRTC timeout and
    // logs "snapshot handler slow to respond".
    if (this.camera.cameraOnline === false) {
      callback(new Error("Camera is offline"));
      return;
    }

    // Serve from cache when fresh — HomeKit polls snapshots aggressively
    // (every few seconds when the camera tile is visible).
    if (this._snapshotCache && this._snapshotCache.expiresAt > Date.now()) {
      callback(undefined, this._snapshotCache.buffer);
      return;
    }

    // Concurrent requests share one capture.
    if (!this._snapshotInFlight) {
      this._snapshotInFlight = this._fetchSnapshot().finally(() => {
        this._snapshotInFlight = null;
      });
    }
    try {
      callback(undefined, await this._snapshotInFlight);
    } catch (err) {
      this.camera.plugin.log.error(
        `[Camera] [Snapshot] Failed for ${this.camera.display_name}: ${err.message}`
      );
      callback(err);
    }
  }

  async _fetchSnapshot() {
    const remember = (buffer) => {
      this._snapshotCache = { buffer, expiresAt: Date.now() + SNAPSHOT_CACHE_MS };
      this._lastSnapshot = buffer;
      return buffer;
    };

    // Try the cloud thumbnail URL straight from the device payload we
    // already have cached on the accessory. Avoids re-fetching the entire
    // Wyze device list, which was the main source of "slow to respond".
    const thumbUrl = this.camera.device?.device_params?.camera_thumbnails?.[0]?.url;
    if (thumbUrl) {
      try {
        const resp = await axios.get(thumbUrl, {
          responseType: "arraybuffer",
          timeout: 4000,
        });
        return remember(Buffer.from(resp.data));
      } catch (err) {
        this.camera.plugin.log.warn?.(
          `[Camera] [Snapshot] Cloud thumb failed for ${this.camera.display_name}: ${err.message} — falling back to capture`
        );
      }
    }

    // A camera serves one WebRTC session at a time: a capture and a live stream
    // started together knock each other out (seen on the Doorbell v2). While a
    // stream is active, show the last picture instead of opening another session.
    // (Only the WebRTC capture below is affected; the cloud thumbnail above is a
    // plain HTTP fetch.)
    if (this._streamActive()) {
      if (this._lastSnapshot) return this._lastSnapshot;
      throw new Error("Live stream in progress");
    }

    // Last resort: full WebRTC capture. Slow, so we cache the result.
    let result;
    try {
      result = await this.camera.plugin.client.getCameraSnapshotImage(
        this.camera.mac,
        { skipCloud: true, label: this.camera.display_name }
      );
    } catch (err) {
      // A stream can claim the camera between the check above and this call (HomeKit asks
      // for a tile picture just as a live view opens). Show the last picture instead of failing.
      if (/live stream/.test(err.message) && this._lastSnapshot) return this._lastSnapshot;
      throw err;
    }
    return remember(result.buffer);
  }

  async prepareStream(request, callback) {
    const sessionKey = request.sessionID.toString("hex");
    const { localRtpPort, localAudioRtpPort, videoSsrc, audioSsrc, localAddress } =
      await this.camera.plugin.client.prepareCameraHKStream();

    // Generate the SRTP keys we will use when sending to HomeKit.
    // These must match what we give FFmpeg — HomeKit's own srtp_key/salt
    // in the request are for the reverse direction (HomeKit → plugin).
    const videoSrtpKey = nodeCrypto.randomBytes(16);
    const videoSrtpSalt = nodeCrypto.randomBytes(14);
    const audioSrtpKey = nodeCrypto.randomBytes(16);
    const audioSrtpSalt = nodeCrypto.randomBytes(14);

    this._sessions.set(sessionKey, {
      localRtpPort,
      localAudioRtpPort,
      videoSsrc,
      audioSsrc,
      targetAddress: request.targetAddress,
      videoPort: request.video.port,
      rtcpPort: request.video.rtcp_port ?? request.video.port + 1,
      srtpKey: videoSrtpKey,
      srtpSalt: videoSrtpSalt,
      audioPort: request.audio?.port ?? null,
      audioRtcpPort: request.audio?.rtcp_port ?? (request.audio?.port ? request.audio.port + 1 : null),
      audioSrtpKey,
      audioSrtpSalt,
      streamHandle: null,
    });

    callback(undefined, {
      address: { address: localAddress, type: "v4" },
      video: {
        port: localRtpPort,
        ssrc: videoSsrc,
        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
      audio: {
        port: localAudioRtpPort,
        ssrc: audioSsrc,
        srtp_key: audioSrtpKey,
        srtp_salt: audioSrtpSalt,
      },
    });
  }

  handleStreamRequest(request, callback) {
    const { hap } = require("../types");
    const { StreamRequestTypes } = hap;
    const sessionKey = request.sessionID.toString("hex");
    const session = this._sessions.get(sessionKey);

    // HomeKit's RTP-stream characteristic write must ack within ~5s. WebRTC
    // negotiation alone can take longer, so acknowledge immediately and do
    // the actual start/stop work in the background.
    if (typeof callback === "function") callback();

    if (
      request.type === StreamRequestTypes.START ||
      request.type === StreamRequestTypes.RECONFIGURE
    ) {
      if (!session) return;
      session.streamHandle?.stop();
      session.streamHandle = null;
      // A quick RECONFIGURE after a START must not start a second stream: only the
      // latest request keeps its handle. (A snapshot capture in flight is ended by
      // wyze-api when the stream claims the camera, so there is nothing to wait for.)
      const token = (session.startToken = (session.startToken ?? 0) + 1);
      session.starting = true;
      session.startingSince = Date.now();
      (async () => {
        try {
          const handle = await this.camera.plugin.client.startCameraHKStream(
            this.camera.mac,
            this.camera.product_model,
            {
              localRtpPort: session.localRtpPort,
              localAudioRtpPort: session.localAudioRtpPort,
              targetAddress: session.targetAddress,
              videoPort: session.videoPort,
              rtcpPort: session.rtcpPort,
              srtpKey: session.srtpKey,
              srtpSalt: session.srtpSalt,
              videoSsrc: session.videoSsrc,
              audioPort: session.audioPort,
              audioRtcpPort: session.audioRtcpPort,
              audioSrtpKey: session.audioSrtpKey,
              audioSrtpSalt: session.audioSrtpSalt,
              audioSsrc: session.audioSsrc,
              bitrate: request.video?.max_bit_rate ?? 300,
              label: this.camera.display_name,
              logger: this.camera.plugin.config.pluginLoggingEnabled
                ? this.camera.plugin.log
                : null,
            }
          );
          // The session may have been torn down, or superseded by a newer START or
          // RECONFIGURE, while we were awaiting.
          if (this._sessions.get(sessionKey) === session && session.startToken === token) {
            session.streamHandle = handle;
          } else {
            handle?.stop();
          }
        } catch (err) {
          this.camera.plugin.log.error(
            `[Camera] [Stream] Failed for ${this.camera.display_name}: ${err.message}`
          );
        } finally {
          if (session.startToken === token) session.starting = false;
        }
      })();
    } else if (request.type === StreamRequestTypes.STOP) {
      if (session) {
        session.streamHandle?.stop();
        this._sessions.delete(sessionKey);
      }
    }
  }
}

module.exports = WyzeCameraStreamingDelegate;
