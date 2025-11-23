import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyASA8KptfOy9pezf3QCoWHt9Bg28yN3HsM",
    authDomain: "amce-5d785.firebaseapp.com",
    projectId: "amce-5d785",
    storageBucket: "amce-5d785.appspot.com",
    messagingSenderId: "877483628426",
    appId: "1:877483628426:web:dfd8961b06c35e6cc95a73"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Session Persistence
setPersistence(auth, browserLocalPersistence)
    .then(() => console.log("Session persistence set to LOCAL"))
    .catch((error) => console.error("Error setting persistence:", error));

const mainContainer = document.getElementById('mainContainer');
let currentPlaylist = [];
let player; 
let testVideoPlayer;

let progressInterval;
let toastTimeout;
let idmDetectionInterval; 

// --- NEW TIMEOUT VARIABLES ---
let activityTimer;
let warningCountdownTimer;
const INACTIVITY_LIMIT = 15 * 60 * 1000; // විනාඩි 15 කට පස්සේ Warning එක එනවා
const WARNING_DURATION = 60 * 1000;      // Warning එක ඇවිත් තත්පර 60ක් දෙනවා Click කරන්න

// --- Safe Zone Variables ---
let isSafeZoneActive = false;
let safeZoneActivationTimeout;
const SAFE_ZONE_ACTIVATION_DELAY = 15 * 60 * 1000; // විනාඩි 15ක් යනකම් Safe Zone Active වෙන්නේ නෑ

function showPopup(title, message, onOk) {
    const template = document.getElementById('popupTemplate').content.cloneNode(true);
    const popup = template.firstElementChild;
    popup.querySelector('#popupTitle').textContent = title;
    popup.querySelector('#popupMessage').textContent = message;
    popup.querySelector('#popupCloseBtn').addEventListener('click', () => {
        popup.remove();
        if (onOk) onOk();
    });
    document.body.appendChild(popup);
}

// --- NEW WARNING POPUP FUNCTION ---
function showInactivityWarning() {
    // වීඩියෝ එක Play වෙනවා නම් Warning එක පෙන්නන්න එපා, Timer එක Reset කරන්න
    if (player && player.getPlayerState() === YT.PlayerState.PLAYING) {
        console.log("Video is playing. Resetting timer automatically.");
        resetActivityTimer();
        return;
    }

    // වීඩියෝ එක Play වෙන්නේ නැත්නම් Warning එක පෙන්නන්න
    const warningDiv = document.createElement('div');
    warningDiv.id = 'inactivity-warning-popup';
    warningDiv.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); z-index: 99999; display: flex;
        justify-content: center; align-items: center; flex-direction: column;
        color: white; text-align: center;
    `;
    
    warningDiv.innerHTML = `
        <div style="background: #1f2937; padding: 30px; border-radius: 15px; border: 1px solid #7c3aed; max-width: 400px;">
            <i class="fas fa-bed" style="font-size: 3rem; color: #f59e0b; margin-bottom: 20px;"></i>
            <h2 style="margin-bottom: 10px;">Are you still watching?</h2>
            <p>You have been inactive for a while.</p>
            <p style="font-size: 0.9rem; color: #d1d5db; margin: 15px 0;">Logging out in <span id="logout-countdown" style="font-weight:bold; color:#ef4444;">60</span> seconds...</p>
            <button id="stay-logged-in-btn" style="background: #7c3aed; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem;">
                I'm Still Here
            </button>
        </div>
    `;
    
    document.body.appendChild(warningDiv);

    let timeLeft = 60;
    const countdownEl = document.getElementById('logout-countdown');
    
    // තත්පරෙන් තත්පරේ අඩු වෙන විදිය (Countdown)
    const countdownInterval = setInterval(() => {
        timeLeft--;
        if(countdownEl) countdownEl.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);

    // "I'm Still Here" Button Action
    document.getElementById('stay-logged-in-btn').addEventListener('click', () => {
        clearInterval(countdownInterval);
        clearTimeout(warningCountdownTimer);
        warningDiv.remove();
        resetActivityTimer(); // Timer එක ආයේ මුල ඉඳන් පටන් ගන්නවා
    });

    // තත්පර 60ක් ඇතුලත Click කරේ නැත්නම් Logout වෙනවා
    warningCountdownTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        warningDiv.remove();
        handleLogout();
    }, WARNING_DURATION);
}

function handleLogout() {
    clearTimeout(safeZoneActivationTimeout);
    clearTimeout(activityTimer); // Clear activity timer
    clearTimeout(warningCountdownTimer); // Clear warning timer
    
    // Remove warning popup if exists
    const existingWarning = document.getElementById('inactivity-warning-popup');
    if(existingWarning) existingWarning.remove();

    isSafeZoneActive = false; 
    const mouseOutOverlay = document.getElementById('mouse-out-overlay');
    if (mouseOutOverlay) {
        mouseOutOverlay.classList.remove('show');
    }
    const downloadBlockedOverlay = document.getElementById('download-blocked-overlay');
    if (downloadBlockedOverlay) {
        downloadBlockedOverlay.style.display = 'none';
    }

    signOut(auth).catch(error => console.error("Logout error:", error));
}

function resetActivityTimer() {
    clearTimeout(activityTimer);
    clearTimeout(warningCountdownTimer);
    
    // Remove warning popup if user moves mouse just before it appears
    const existingWarning = document.getElementById('inactivity-warning-popup');
    if(existingWarning) existingWarning.remove();

    if (auth.currentUser && mainContainer.classList.contains('video-view-container')) {
        // කාලය ඉවර වුනාම කෙලින්ම Logout නොවී Warning එක එන Function එක කෝල් කරනවා
        activityTimer = setTimeout(showInactivityWarning, INACTIVITY_LIMIT);
    }
}

function setupActivityListeners() {
    document.addEventListener('mousemove', resetActivityTimer);
    document.addEventListener('keydown', resetActivityTimer);
    document.addEventListener('click', resetActivityTimer);
    document.addEventListener('scroll', resetActivityTimer);
    resetActivityTimer();
}

function removeActivityListeners() {
    clearTimeout(activityTimer);
    clearTimeout(warningCountdownTimer);
    document.removeEventListener('mousemove', resetActivityTimer);
    document.removeEventListener('keydown', resetActivityTimer);
    document.removeEventListener('click', resetActivityTimer);
    document.removeEventListener('scroll', resetActivityTimer);
}

// --- IDM Detection Function ---
function checkForIDMAttribute() {
    const videoElement = document.getElementById('testVideoPlayer'); 
    const downloadBlockedOverlay = document.getElementById('download-blocked-overlay');

    if (videoElement && videoElement.hasAttribute('idm_id')) {
        if (testVideoPlayer) testVideoPlayer.pause(); 
        if (player && typeof player.pauseVideo === 'function') {
            player.pauseVideo(); 
        }
        if (downloadBlockedOverlay) downloadBlockedOverlay.style.display = 'flex';
        return true;
    } else if (downloadBlockedOverlay) {
        downloadBlockedOverlay.style.display = 'none';
    }
    return false;
}

function setupIDMDetection() {
    clearInterval(idmDetectionInterval); 
    if (document.getElementById('testVideoPlayer') && mainContainer.classList.contains('video-view-container')) {
        idmDetectionInterval = setInterval(() => {
            checkForIDMAttribute();
        }, 1000); 
    } else {
        clearInterval(idmDetectionInterval);
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        if (user.emailVerified) {
            if (mainContainer.className !== 'main-container video-view-container') {
                showView('video');
            }
            setupActivityListeners();
        } else {
            showPopup(
                "Email Not Verified",
                "Your email address has not been verified.",
                () => {
                    signOut(auth);
                    showView('login');
                }
            );
        }
    } else {
        if (mainContainer.className.includes('video-view-container') || !auth.currentUser) {
            showView('login');
        }
        removeActivityListeners();
    }
});

async function showView(viewName) {
    mainContainer.innerHTML = '';
    const template = document.getElementById(viewName + 'Template').content.cloneNode(true);
    
    mainContainer.className = viewName === 'video' ? 'main-container video-view-container' : 'main-container';
    
    mainContainer.appendChild(template);
    attachEventListeners(viewName);

    if (viewName === 'video') {
        isSafeZoneActive = false;
        const safeZoneElement = document.getElementById('safe-interaction-zone');
        if (safeZoneElement) {
            safeZoneElement.classList.remove('active'); 
        }
        clearTimeout(safeZoneActivationTimeout); 
        
        // 15 Minutes Delay for Safe Zone
        safeZoneActivationTimeout = setTimeout(() => {
            isSafeZoneActive = true;
            if (safeZoneElement) {
                safeZoneElement.classList.add('active'); 
            }
        }, SAFE_ZONE_ACTIVATION_DELAY);

        if (typeof YT !== 'undefined' && YT.Player) {
            onYouTubeIframeAPIReady();
        } 
        renderPlaylist(currentPlaylist);
        populateWatermark('#video-watermark');
        resetActivityTimer();
        setupIDMDetection(); 
    } else {
        removeActivityListeners();
        clearInterval(idmDetectionInterval); 
        clearTimeout(safeZoneActivationTimeout);
        isSafeZoneActive = false;
    }
}

function attachEventListeners(viewName) {
    const passwordToggles = mainContainer.querySelectorAll('.password-toggle');
    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const passwordInput = toggle.previousElementSibling;
            passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
            toggle.classList.toggle('fa-eye-slash');
        });
    });

    if (viewName === 'login') {
        mainContainer.querySelector('.showRegisterLink').addEventListener('click', (e) => { e.preventDefault(); showView('register'); });
        mainContainer.querySelector('#loginForm').addEventListener('submit', handleLogin);
    } else if (viewName === 'register') {
        mainContainer.querySelector('.showLoginLink').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });
        mainContainer.querySelector('#registerForm').addEventListener('submit', handleRegister);
    } else if (viewName === 'video') {
        mainContainer.querySelector('.logout-button').addEventListener('click', handleLogout);
        
        const playPauseBtn = mainContainer.querySelector('#play-pause-btn');
        const fullscreenBtn = mainContainer.querySelector('#fullscreen-btn');
        const progressContainer = mainContainer.querySelector('#progress-container');

        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => player?.getPlayerState() === YT.PlayerState.PLAYING ? player.pauseVideo() : player.playVideo());
        }
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => document.getElementById('video-wrapper')?.requestFullscreen());
        }
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                if (!player || typeof player.getDuration !== 'function') return;
                const rect = e.currentTarget.getBoundingClientRect();
                const newTime = ((e.clientX - rect.left) / rect.width) * player.getDuration();
                player.seekTo(newTime, true);
            });
        }
        
        const playlistSearch = mainContainer.querySelector('#playlistSearch');
        if (playlistSearch) {
            playlistSearch.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                document.querySelectorAll('#videoPlaylist li').forEach(item => {
                    item.style.display = item.textContent.toLowerCase().includes(searchTerm) ? '' : 'none';
                });
            });
        }

        // --- Safe Interaction Zone ---
        const safeZoneElement = mainContainer.querySelector('#safe-interaction-zone');
        const mouseOutOverlay = mainContainer.querySelector('#mouse-out-overlay');

        if (safeZoneElement && mouseOutOverlay) {
            safeZoneElement.addEventListener('mouseleave', () => {
                if (isSafeZoneActive) {
                    // Safe zone triggered: Pause video and show overlay, but DO NOT logout immediately
                    if (player && typeof player.pauseVideo === 'function') {
                        player.pauseVideo(); 
                    }
                    mouseOutOverlay.classList.add('show'); 
                }
            });

            safeZoneElement.addEventListener('mouseenter', () => {
                if (mouseOutOverlay) {
                    mouseOutOverlay.classList.remove('show');
                }
            });
        }

        // --- VISIBILITY CHANGE (TAB SWITCH) ---
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Tab switch triggered: Pause video only, DO NOT logout immediately
                console.log("Tab hidden. Pausing video.");
                if (player && typeof player.pauseVideo === 'function') {
                    player.pauseVideo(); 
                }
            } else {
                resetActivityTimer();
            }
        });
        
        window.addEventListener('blur', () => {
            if (player && typeof player.pauseVideo === 'function') {
                player.pauseVideo();
            }
            if (mouseOutOverlay) { 
                 mouseOutOverlay.classList.add('show');
            }
        });

        window.addEventListener('focus', () => {
            if (mouseOutOverlay) {
                mouseOutOverlay.classList.remove('show');
            }
            resetActivityTimer();
        });
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = mainContainer.querySelector('#loginEmail').value;
    const password = mainContainer.querySelector('#loginPassword').value;
    const messageEl = mainContainer.querySelector('#loginMessage');
    const submitBtn = e.submitter;
    submitBtn.disabled = true;
    messageEl.textContent = "Logging in...";
    try {
        await setPersistence(auth, browserLocalPersistence); 
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        messageEl.textContent = 'Invalid email or password.';
    } finally {
        submitBtn.disabled = false;
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = mainContainer.querySelector('#registerUsername').value;
    const email = mainContainer.querySelector('#registerEmail').value;
    const mobile = mainContainer.querySelector('#registerMobile').value;
    const password = mainContainer.querySelector('#registerPassword').value;
    const messageEl = mainContainer.querySelector('#registerMessage');
    const submitBtn = e.submitter;
    submitBtn.disabled = true;
    messageEl.textContent = "Registering...";
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", userCredential.user.uid), { username, email, mobile, createdAt: new Date() });
        await sendEmailVerification(userCredential.user);
        showPopup("Registration Successful!", "A verification link has been sent to your email.", () => showView('login'));
    } catch (error) {
        messageEl.textContent = error.message;
    } finally {
        submitBtn.disabled = false;
    }
}

async function populateWatermark(containerSelector) {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const watermarkContainer = document.querySelector(containerSelector);
    if (!watermarkContainer) return;
    const userDocRef = doc(db, "users", currentUser.uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
        const { username, mobile } = userDocSnap.data();
        const details = `${username} / ${currentUser.email} / ${mobile}`;
        let html = '';
        for (let i = 0; i < 200; i++) html += `<span class="watermark-item">${details}</span>`;
        watermarkContainer.innerHTML = html;
    }
}

window.onYouTubeIframeAPIReady = function() {
    if (document.getElementById('player')) {
        player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: { 'playsinline': 1, 'controls': 0, 'rel': 0, 'showinfo': 0, 'modestbranding': 1, 'fs': 0 },
            events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
        });
    }
    testVideoPlayer = document.getElementById('testVideoPlayer');
}

function onPlayerReady(event) {
    if (currentPlaylist.length > 0) {
        event.target.cueVideoById(currentPlaylist[0].id);
    }
}

function onPlayerStateChange(event) {
    const videoWrapper = document.getElementById('video-wrapper');
    const playPauseBtnIcon = document.querySelector('#play-pause-btn i');
    if (!videoWrapper || !playPauseBtnIcon) return;
    clearInterval(progressInterval);
    if (event.data == YT.PlayerState.PLAYING) {
        videoWrapper.classList.add('playing');
        playPauseBtnIcon.className = 'fas fa-pause';
        progressInterval = setInterval(updateProgressBar, 250);
        
        // --- NEW: Reset Timer when video starts playing ---
        resetActivityTimer(); 
    } else {
        videoWrapper.classList.remove('playing');
        playPauseBtnIcon.className = 'fas fa-play';
        resetActivityTimer(); // Reset timer on pause too
    }
}

function updateProgressBar() {
    if (!player || typeof player.getDuration !== 'function') return;
    const progressBar = document.getElementById('progress-bar');
    const currentTime = player.getCurrentTime();
    const duration = player.getDuration();
    if (progressBar && duration > 0) {
        progressBar.style.width = `${(currentTime / duration) * 100}%`;
    }
}

function renderPlaylist(playlist) {
    const playlistElement = document.getElementById('videoPlaylist');
    if (!playlistElement) return;
    playlistElement.innerHTML = '';
    if (playlist.length === 0) {
        playlistElement.innerHTML = `<li>No videos available yet.</li>`;
        return;
    }
    playlist.forEach((video, index) => {
        const listItem = document.createElement('li');
        listItem.className = 'playlist-item';
        listItem.innerHTML = `<strong class="playlist-item-title">${video.title}</strong><p class="playlist-item-desc">${video.description || ''}</p>`;
        listItem.addEventListener('click', () => {
            if (player && player.loadVideoById) {
                player.loadVideoById(video.id);
                document.querySelector('#videoPlaylist li.active')?.classList.remove('active');
                listItem.classList.add('active');
            }
        });
        if (index === 0) listItem.classList.add('active');
        playlistElement.appendChild(listItem);
    });
}

const videosQuery = query(collection(db, "videos"), orderBy("createdAt", "desc"));
onSnapshot(videosQuery, (snapshot) => {
    currentPlaylist = [];
    snapshot.forEach((doc) => currentPlaylist.push(doc.data()));
    if (document.getElementById('videoPlaylist')) {
        renderPlaylist(currentPlaylist);
    }
});

document.addEventListener('keydown', e => { 
    if (document.getElementById('video-wrapper')) { 
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            return; 
        }
        e.preventDefault(); 
        
        const toast = document.getElementById('keyboard-disabled-toast');
        if (toast) {
            clearTimeout(toastTimeout);
            toast.classList.add('show');
            toastTimeout = setTimeout(() => toast.classList.remove('show'), 1500);
        }
    }
});

document.addEventListener('contextmenu', e => e.preventDefault());

if (!auth.currentUser) {
    showView('login');
}