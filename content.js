(function () {
    if (window.VolumeBooster) {
        return;
    }

    window.VolumeBooster = {
        targetSpeed: 1.0,
        monitoringInterval: null,
        _observer: null,
        audioCtx: null,
        gainNode: null,
        connectedVideo: null,

        ensureCrossOrigin: function (video) {
            if (!video) return;

            // Do NOT touch video elements on YouTube or same-origin / blob media
            const hostname = window.location.hostname;
            if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
                return;
            }

            const currentSrc = video.currentSrc || video.src || "";
            if (!currentSrc || currentSrc.startsWith("blob:") || currentSrc.startsWith("data:")) {
                return;
            }

            try {
                const mediaOrigin = new URL(currentSrc, window.location.href).origin;
                const pageOrigin = window.location.origin;

                // Only set crossorigin="anonymous" if the video is strictly CROSS-ORIGIN
                if (mediaOrigin !== pageOrigin && video.crossOrigin !== "anonymous") {
                    video.crossOrigin = "anonymous";
                    // If video media source was already loaded without CORS header
                    if (video.readyState > 0) {
                        const currentTime = video.currentTime;
                        const isPaused = video.paused;
                        video.src = currentSrc;
                        video.currentTime = currentTime;
                        if (!isPaused) {
                            video.play().catch(() => {});
                        }
                    }
                }
            } catch (e) {
                // Ignore URL parsing errors
            }
        },

        initAudioContext: function (video) {
            if (this.gainNode && this.connectedVideo === video) {
                return this.gainNode;
            }

            if (video._vb_gainNode) {
                this.gainNode = video._vb_gainNode;
                this.connectedVideo = video;
                return video._vb_gainNode;
            }

            this.ensureCrossOrigin(video);

            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!this.audioCtx) {
                    this.audioCtx = video._vb_audioCtx || new AudioContext();
                }
                const ctx = this.audioCtx;

                const source = ctx.createMediaElementSource(video);
                const gainNode = ctx.createGain();

                source.connect(gainNode);
                gainNode.connect(ctx.destination);

                video._vb_gainNode = gainNode;
                video._vb_audioCtx = ctx;
                this.gainNode = gainNode;
                this.connectedVideo = video;
                return gainNode;
            } catch (e) {
                // Use console.info instead of console.warn/console.error so expected browser
                // restrictions (e.g. cross-origin ad iframes, already hooked video before page reload)
                // do not generate noisy error entries in chrome://extensions.
                console.info("Volume Booster: AudioContext attachment notice:", e.name, e.message);
                return null;
            }
        },

        resumeAudioContext: function () {
            const video = this.findVideo();
            const ctx = this.audioCtx || (video && video._vb_audioCtx);
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
        },

        findVideo: function () {
            const selectors = [
                ".html5-main-video",
                "#hivePlayer1",
                "video"
            ];

            for (let selector of selectors) {
                const el = document.querySelector(selector);
                if (el) return el;
            }
            return null;
        },

        update: function (volume, speed) {
            const video = this.findVideo();
            if (!video) return "No video found";

            // 1. Handle TabIndex
            video.tabIndex = 1;

            // 2. Handle Volume
            if (volume !== undefined && volume !== null) {
                if (volume <= 1.0 && !video._vb_gainNode && !this.gainNode) {
                    // Use native element volume for non-boosted volume when AudioContext isn't attached yet
                    video.volume = Math.max(0, Math.min(1, volume));
                } else {
                    // Use Web Audio GainNode for boosting (> 1.0) or if AudioContext is already attached
                    const gainNode = this.initAudioContext(video);
                    if (gainNode) {
                        gainNode.gain.value = volume;
                    } else {
                        // Fallback to max native volume if Web Audio could not be attached
                        video.volume = 1.0;
                    }
                    this.resumeAudioContext();
                }
            }

            // 3. Handle Speed
            if (speed !== undefined && speed !== null) {
                this.targetSpeed = speed;
                video.playbackRate = speed;
                if (speed > 1.0) {
                    this.startMonitoring();
                } else {
                    this.stopMonitoring();
                }
            }

            return `Applied: Vol ${volume}x, Spd ${speed}x`;
        },

        startMonitoring: function () {
            if (this.monitoringInterval || this.targetSpeed <= 1.0) return;

            this.monitoringInterval = setInterval(() => {
                this.checkLiveStatus();
            }, 1000);
        },

        stopMonitoring: function () {
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }
        },

        checkLiveStatus: function () {
            const video = this.findVideo();
            if (!video) return;

            // Logic: If we are buffering or running out of buffer while speeding, reset to 1.0x.
            // This applies to both Live streams and VODs with poor connection/buffering.

            const SLOW_DOWN_THRESHOLD = 3.0; // Threshold in seconds
            let shouldReset = false;

            // 1. Check Ready State (Stalling)
            // HAVE_FUTURE_DATA = 3, HAVE_ENOUGH_DATA = 4
            if (video.readyState < 3) {
                shouldReset = true;
            }

            // 2. Check Buffer Health
            const buffered = video.buffered;
            if (buffered.length > 0) {
                // Find the buffered range that contains the current time
                let currentRangeEnd = 0;
                for (let i = 0; i < buffered.length; i++) {
                    if (video.currentTime >= buffered.start(i) && video.currentTime <= buffered.end(i)) {
                        currentRangeEnd = buffered.end(i);
                        break;
                    }
                }

                // If we found a range, check distance to end
                if (currentRangeEnd > 0) {
                    const distance = currentRangeEnd - video.currentTime;
                    if (distance < SLOW_DOWN_THRESHOLD) {
                        shouldReset = true;
                    }
                }
            }

            // Apply Reset if needed
            if (shouldReset && this.targetSpeed > 1.0) {
                if (video.playbackRate !== 1.0) {
                    video.playbackRate = 1.0;
                    this.targetSpeed = 1.0; // Permanently reset
                    this.stopMonitoring();
                }
            } else if (!shouldReset && this.targetSpeed > 1.0) {
                // Enforce target speed if we have enough buffer and not stalling
                // This handles the case where the browser might have auto-reset the speed
                if (Math.abs(video.playbackRate - this.targetSpeed) > 0.1) {
                    video.playbackRate = this.targetSpeed;
                }
            }
        },

        getSettings: function () {
            const video = this.findVideo();
            if (!video) return null;

            let volume = 1.0;
            const gainNode = this.gainNode || video._vb_gainNode;
            if (gainNode) {
                volume = gainNode.gain.value;
            } else {
                video.volume = video.volume;
            }

            // Return targetSpeed if we are managing it, otherwise current rate
            // This ensures the UI shows the user's *desired* speed even if we temporarily slowed down
            const speed = this.targetSpeed || video.playbackRate || 1.0;

            return { volume, speed };
        },

        initAutoCORS: function () {
            // Do NOT run CORS monitoring or MutationObserver on YouTube:
            // YouTube never requires crossOrigin modifications and its dynamic DOM causes high observer overhead
            const hostname = window.location.hostname;
            if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
                return;
            }

            // Set crossorigin="anonymous" on existing video elements
            const videos = document.querySelectorAll('video');
            videos.forEach(v => this.ensureCrossOrigin(v));

            // Observe DOM for dynamically inserted video elements
            if (window.MutationObserver && !this._observer) {
                this._observer = new MutationObserver((mutations) => {
                    for (let mutation of mutations) {
                        for (let node of mutation.addedNodes) {
                            if (node.nodeName === 'VIDEO') {
                                this.ensureCrossOrigin(node);
                            } else if (node.querySelectorAll) {
                                const subVideos = node.querySelectorAll('video');
                                subVideos.forEach(v => this.ensureCrossOrigin(v));
                            }
                        }
                    }
                });
                this._observer.observe(document.body || document.documentElement, {
                    childList: true,
                    subtree: true
                });
            }
        }
    };

    // Auto initialize CORS monitoring on videos (skipped on YouTube)
    window.VolumeBooster.initAutoCORS();

    // Keep the message listener for backward compatibility or if needed, 
    // but popup.js will likely call window.VolumeBooster.update directly.
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "update") {
            const result = window.VolumeBooster.update(request.volume, request.speed);
            sendResponse({ status: result });
        }
    });

})();
