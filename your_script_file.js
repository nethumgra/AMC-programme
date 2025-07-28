import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

const mainContainer = document.getElementById('mainContainer');
let currentPlaylist = [];
let player; // This will be your YouTube Player
let testVideoPlayer; // For direct <video> tag testing (if you uncommented it in HTML)
let progressInterval;
let toastTimeout;
let idmDetectionInterval; // New variable for IDM detection interval

let activityTimer;
const INACTIVITY_TIMEOUT = 30 * 1000; // 30 seconds

// NEW: Variables for Safe Zone Logic
let isSafeZoneActive = false;
let safeZoneActivationTimeout;
const SAFE_ZONE_ACTIVATION_DELAY = 20 * 1000; // 20 seconds

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

function handleLogout() {
    // NEW: Clear safe zone activation timeout on logout
    clearTimeout(safeZoneActivationTimeout);
    isSafeZoneActive = false; // Reset safe zone status
    // Hide any active overlays when logging out
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
    if (auth.currentUser && mainContainer.classList.contains('video-view-container')) {
        activityTimer = setTimeout(() => {
            console.log("User inactive for too long, logging out...");
            handleLogout();
        }, INACTIVITY_TIMEOUT);
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
    document.removeEventListener('mousemove', resetActivityTimer);
    document.removeEventListener('keydown', resetActivityTimer);
    document.removeEventListener('click', resetActivityTimer);
    document.removeEventListener('scroll', resetActivityTimer);
}

// --- IDM Detection Function ---
function checkForIDMAttribute() {
    // This function assumes you are testing with a direct <video> tag with id="testVideoPlayer"
    // If you are only using YouTube iframe, the IDM detection might not work this way.
    const videoElement = document.getElementById('testVideoPlayer'); // Check your HTML for this element
    const downloadBlockedOverlay = document.getElementById('download-blocked-overlay');

    if (videoElement && videoElement.hasAttribute('idm_id')) {
        console.warn("IDM attribute detected on <video> tag!");
        if (testVideoPlayer) testVideoPlayer.pause(); // Pause direct video
        if (player && typeof player.pauseVideo === 'function') {
            player.pauseVideo(); // Attempt to pause YouTube player if active
        }
        if (downloadBlockedOverlay) downloadBlockedOverlay.style.display = 'flex';
        // You might want to clearInterval(idmDetectionInterval) here if you want to stop checking
        // once IDM is detected until the page is refreshed/reloaded.
        return true;
    } else if (downloadBlockedOverlay) {
        downloadBlockedOverlay.style.display = 'none';
    }
    return false;
}

function setupIDMDetection() {
    clearInterval(idmDetectionInterval); // Clear any previous interval
    // Only set up IDM detection if we are in the video view and 'testVideoPlayer' exists (for direct video testing)
    if (document.getElementById('testVideoPlayer') && mainContainer.classList.contains('video-view-container')) {
        idmDetectionInterval = setInterval(() => {
            checkForIDMAttribute();
        }, 1000); // Check every second
    } else {
        // If not in video view or no testVideoPlayer, ensure interval is cleared
        clearInterval(idmDetectionInterval);
    }
}
// --- End IDM Detection Function ---


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
                "Your email address has not been verified. Please check your inbox (and spam folder) for a verification link. You will be logged out.",
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
        // NEW: Reset safe zone state and start activation timer
        isSafeZoneActive = false;
        const safeZoneElement = document.getElementById('safe-interaction-zone');
        if (safeZoneElement) {
            safeZoneElement.classList.remove('active'); // Ensure it's not active initially
        }
        clearTimeout(safeZoneActivationTimeout); // Clear any previous timer
        safeZoneActivationTimeout = setTimeout(() => {
            isSafeZoneActive = true;
            console.log("Safe interaction zone is now ACTIVE!");
            if (safeZoneElement) {
                safeZoneElement.classList.add('active'); // Activate mouse event capturing
            }
        }, SAFE_ZONE_ACTIVATION_DELAY);

        if (typeof YT !== 'undefined' && YT.Player) {
            onYouTubeIframeAPIReady();
        } else {
            // If YT object is not ready, this will be called when the API loads
            // Make sure the YouTube Iframe API script is loaded globally in your HTML
            // E.g., <script src="https://www.youtube.com/iframe_api"></script>
        }
        renderPlaylist(currentPlaylist);
        populateWatermark('#video-watermark');
        resetActivityTimer();
        setupIDMDetection(); // Start IDM detection when video view loads
    } else {
        removeActivityListeners();
        clearInterval(idmDetectionInterval); // Stop IDM detection when leaving video view
        // NEW: Clear safe zone timer when leaving video view
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
        
        // Ensure player and controls exist before attaching listeners
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

        // --- NEW: Safe Interaction Zone Mouse Listeners ---
        const safeZoneElement = mainContainer.querySelector('#safe-interaction-zone');
        const mouseOutOverlay = mainContainer.querySelector('#mouse-out-overlay');

        if (safeZoneElement && mouseOutOverlay) {
            safeZoneElement.addEventListener('mouseleave', () => {
                // Only act if the safe zone is active (after 20 seconds)
                if (isSafeZoneActive) {
                    console.log("Mouse left safe interaction zone. Redirecting to login!");
                    if (player && typeof player.pauseVideo === 'function') {
                        player.pauseVideo(); // Pause video before redirecting
                    }
                    if (testVideoPlayer) { // Pause direct video if present
                        testVideoPlayer.pause();
                    }
                    mouseOutOverlay.classList.add('show'); // Show message
                    
                    // Immediately redirect to login page after a short delay to show message
                    setTimeout(() => {
                        handleLogout(); // This will show the login page
                    }, 500); // 0.5 seconds delay to allow message to be seen
                }
            });

            // When mouse re-enters, hide the overlay (even if not active yet)
            safeZoneElement.addEventListener('mouseenter', () => {
                if (mouseOutOverlay) {
                    mouseOutOverlay.classList.remove('show');
                }
            });
        }
        // --- END NEW: Safe Interaction Zone Mouse Listeners ---

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (auth.currentUser) {
                    console.log(`[${new Date().toLocaleTimeString()}] Tab is hidden, attempting to log out user: ${auth.currentUser.email}`);
                    handleLogout();
                } else {
                    console.log(`[${new Date().toLocaleTimeString()}] Tab is hidden, but no active user found to log out.`);
                }
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] Tab is visible again.`);
                resetActivityTimer();
            }
        });
        
        // Window blur/focus listeners
        window.addEventListener('blur', () => {
            console.log(`[${new Date().toLocaleTimeString()}] Browser window lost focus.`);
            if (player && typeof player.pauseVideo === 'function') {
                player.pauseVideo();
            }
            if (testVideoPlayer) { // Pause direct video if present
                testVideoPlayer.pause();
            }
            if (mouseOutOverlay) { // Show the overlay if window blurs
                 mouseOutOverlay.classList.add('show');
            }
        });

        window.addEventListener('focus', () => {
            console.log(`[${new Date().toLocaleTimeString()}] Browser window gained focus.`);
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
        await setPersistence(auth, browserSessionPersistence); 
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
        showPopup("Registration Successful!", "A verification link has been sent to your email. Please check your inbox (and spam folder) to activate your account.", () => showView('login'));
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

// Correct YouTube Iframe API loading. This function is called automatically by YouTube.
window.onYouTubeIframeAPIReady = function() {
    if (document.getElementById('player')) {
        player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: { 'playsinline': 1, 'controls': 0, 'rel': 0, 'showinfo': 0, 'modestbranding': 1, 'fs': 0 },
            events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
        });
    }
    // If you are using a direct <video> tag for IDM testing, uncomment this line:
    testVideoPlayer = document.getElementById('testVideoPlayer');
    // if (testVideoPlayer) {
    //     // Optional: Listen to its events if needed for testing
    // }
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
    } else {
        videoWrapper.classList.remove('playing');
        playPauseBtnIcon.className = 'fas fa-play';
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

// --- UPDATED: Disable ALL keyboard shortcuts except for input fields ---
document.addEventListener('keydown', e => { 
    if (document.getElementById('video-wrapper')) { // Only apply if on the video page
        const activeElement = document.activeElement;
        // Allow typing in input or textarea elements (e.g., search bar)
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
// --- END UPDATED keydown listener ---

// --- Ensure right-click is disabled ---
document.addEventListener('contextmenu', e => e.preventDefault());
// --- End right-click disable ---

// Initial view load based on current auth state
if (!auth.currentUser) {
    showView('login');
} else {
    // This will be handled by the onAuthStateChanged listener already defined above
}