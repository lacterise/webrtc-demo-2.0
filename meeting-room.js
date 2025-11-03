(function() {
  const meetingIdEl = document.getElementById('mr-meeting-id');
  const ipEl = document.getElementById('mr-host-ip');
  const securityBtn = document.getElementById('mr-security-btn');
  const securityPanel = document.getElementById('mr-security-panel');
  const closeSecurityBtn = document.getElementById('mr-close-security');
  const waitingListEl = document.getElementById('mr-waiting-list');
  const participantsListEl = document.getElementById('mr-participants-list');
  const videoGrid = document.getElementById('mr-video-grid');
  const waitingOverlay = document.getElementById('mr-waiting');
  const toggleAudioBtn = document.getElementById('mr-toggle-audio');
  const toggleVideoBtn = document.getElementById('mr-toggle-video');
  const leaveBtn = document.getElementById('mr-leave');

  /*** State ***/
  let peer = null;
  let localStream = null;
  let isHost = false;
  let meetingId = null;
  let displayName = 'Guest';
  let hostIp = '-';

  // Maps
  const peerIdToCall = new Map(); // peerId -> MediaConnection
  const peerIdToData = new Map(); // peerId -> DataConnection
  const peerIdToMediaEl = new Map(); // peerId -> HTMLVideoElement
  const waitingQueue = new Map(); // peerId -> { name }

  /*** Init from create.html or URL ***/
  function loadBootstrapData() {
    try {
      const stored = localStorage.getItem('meetingData');
      if (stored) {
        const parsed = JSON.parse(stored);
        meetingId = parsed.meetingID || parsed.peerId || meetingId;
        isHost = !!parsed.isHost;
        displayName = parsed.username || displayName;
        hostIp = parsed.hostIP || hostIp;
      }
    } catch (e) {
      // ignore
    }

    const params = new URLSearchParams(window.location.search);
    meetingId = params.get('meetingId') || meetingId;
    displayName = params.get('name') || displayName;
    hostIp = params.get('hostIp') || hostIp;
    if (params.has('host')) {
      isHost = params.get('host') === 'true' || params.get('host') === '';
    }

    meetingIdEl.textContent = 'Meeting: ' + (meetingId || '-');
    ipEl.textContent = 'IP: ' + (hostIp || '-');
  }

  async function ensureLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      addOrReplaceTile('local', localStream, displayName + ' (You)');
    } catch (e) {
      alert('Could not access camera/microphone.');
      throw e;
    }
  }

  function createPeer() {
    const config = {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    };
    peer = isHost && meetingId ? new Peer(meetingId, config) : new Peer(undefined, config);

    peer.on('open', (id) => {
      if (!meetingId) meetingId = id;
      meetingIdEl.textContent = 'Meeting: ' + meetingId;
      if (!isHost) {
        // As a guest: request to join host
        requestJoin();
      }
    });

    peer.on('connection', (conn) => {
      // Host receives join requests and peer messaging
      setupDataConnection(conn);
    });

    peer.on('call', (call) => {
      // Answer incoming media calls with local stream
      call.answer(localStream);
      bindMediaConnection(call);
    });

    peer.on('disconnected', () => { /* noop */ });
    peer.on('close', () => { /* noop */ });
    peer.on('error', (err) => {
      console.error('Peer error:', err);
      alert('PeerJS error: ' + err);
    });
  }

  /*** UI helpers ***/
  function addOrReplaceTile(peerId, stream, label) {
    let tile = document.getElementById('tile-' + peerId);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'mr-tile';
      tile.id = 'tile-' + peerId;
      const video = document.createElement('video');
      video.className = 'mr-video';
      video.autoplay = true;
      video.playsInline = true;
      if (peerId === 'local') video.muted = true;
      const name = document.createElement('div');
      name.className = 'mr-name';
      name.textContent = label || peerId;
      const muted = document.createElement('div');
      muted.className = 'mr-muted';
      muted.id = 'muted-' + peerId;
      muted.hidden = true;
      muted.textContent = 'Muted';
      tile.appendChild(video);
      tile.appendChild(name);
      tile.appendChild(muted);
      videoGrid.appendChild(tile);
      peerIdToMediaEl.set(peerId, video);
    }
    const video = peerIdToMediaEl.get(peerId);
    if (video && video.srcObject !== stream) {
      video.srcObject = stream;
    }
  }

  function updateParticipantsList() {
    participantsListEl.innerHTML = '';
    const entries = [...peerIdToData.keys()].filter(pid => pid !== peer?.id);
    entries.forEach((pid) => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.textContent = pid;
      const actions = document.createElement('div');
      actions.className = 'mr-actions';

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mr-btn';
      muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
      muteBtn.onclick = () => sendControl(pid, { type: 'host-mute' });

      const kickBtn = document.createElement('button');
      kickBtn.className = 'mr-btn danger';
      kickBtn.innerHTML = '<i class="fas fa-user-slash"></i>';
      kickBtn.onclick = () => kickParticipant(pid);

      actions.appendChild(muteBtn);
      actions.appendChild(kickBtn);
      li.appendChild(left);
      li.appendChild(actions);
      participantsListEl.appendChild(li);
    });
  }

  function updateWaitingList() {
    waitingListEl.innerHTML = '';
    waitingQueue.forEach((info, pid) => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.textContent = (info.name || 'Guest') + ' (' + pid + ')';
      const actions = document.createElement('div');
      actions.className = 'mr-actions';
      const accept = document.createElement('button');
      accept.className = 'mr-btn';
      accept.innerHTML = '<i class="fas fa-check"></i>';
      accept.onclick = () => admitParticipant(pid);
      const reject = document.createElement('button');
      reject.className = 'mr-btn danger';
      reject.innerHTML = '<i class="fas fa-xmark"></i>';
      reject.onclick = () => rejectParticipant(pid);
      actions.appendChild(accept);
      actions.appendChild(reject);
      li.appendChild(left);
      li.appendChild(actions);
      waitingListEl.appendChild(li);
    });
  }

  /*** Host Controls ***/
  function admitParticipant(pid) {
    const conn = peerIdToData.get(pid);
    if (!conn) return;
    conn.send({ type: 'admitted', meetingId, peers: [...peerIdToData.keys()].filter(x => x !== pid) });
    waitingQueue.delete(pid);
    updateWaitingList();
    updateParticipantsList();
  }

  function rejectParticipant(pid) {
    const conn = peerIdToData.get(pid);
    if (!conn) return;
    conn.send({ type: 'rejected' });
    conn.close();
    waitingQueue.delete(pid);
    peerIdToData.delete(pid);
    updateWaitingList();
    updateParticipantsList();
  }

  function kickParticipant(pid) {
    const conn = peerIdToData.get(pid);
    if (conn) {
      conn.send({ type: 'kicked' });
      conn.close();
    }
    const call = peerIdToCall.get(pid);
    if (call) call.close();
    peerIdToCall.delete(pid);
    peerIdToData.delete(pid);
    removeTile(pid);
    updateParticipantsList();
  }

  function removeTile(peerId) {
    const el = document.getElementById('tile-' + peerId);
    if (el && el.parentElement) el.parentElement.removeChild(el);
    peerIdToMediaEl.delete(peerId);
  }

  function sendControl(pid, payload) {
    const conn = peerIdToData.get(pid);
    if (conn && conn.open) conn.send(payload);
  }

  /*** Connections ***/
  function setupDataConnection(conn) {
    peerIdToData.set(conn.peer, conn);
    updateParticipantsList();

    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'join-request': {
          if (isHost) {
            waitingQueue.set(conn.peer, { name: msg.name });
            updateWaitingList();
          }
          break;
        }
        case 'mesh-list': {
          if (!isHost) {
            // Call peers provided by host
            (msg.peers || []).forEach((pid) => {
              if (pid !== peer.id && !peerIdToCall.has(pid)) placeCall(pid);
            });
          }
          break;
        }
        case 'host-mute': {
          // Host requests client to mute microphone
          setLocalAudio(false);
          break;
        }
      }
    });

    conn.on('close', () => {
      peerIdToData.delete(conn.peer);
      updateParticipantsList();
    });
  }

  function bindMediaConnection(call) {
    peerIdToCall.set(call.peer, call);
    call.on('stream', (remoteStream) => {
      addOrReplaceTile(call.peer, remoteStream, call.peer);
    });
    call.on('close', () => {
      removeTile(call.peer);
      peerIdToCall.delete(call.peer);
    });
  }

  function placeCall(targetPeerId) {
    const call = peer.call(targetPeerId, localStream);
    if (!call) return;
    bindMediaConnection(call);
  }

  function requestJoin() {
    if (!meetingId) return;
    const conn = peer.connect(meetingId, { reliable: true });
    conn.on('open', () => {
      peerIdToData.set(conn.peer, conn);
      conn.send({ type: 'join-request', name: displayName });
    });
    conn.on('data', (msg) => {
      if (msg?.type === 'admitted') {
        waitingOverlay.hidden = true;
        // Call host immediately
        placeCall(msg.hostId || meetingId);
        // Start calling mesh peers
        (msg.peers || []).forEach((pid) => { if (pid !== peer.id) placeCall(pid); });
      } else if (msg?.type === 'rejected' || msg?.type === 'kicked') {
        alert('You cannot join this meeting.');
        window.location.href = 'index.html';
      }
    });
    conn.on('close', () => {
      peerIdToData.delete(conn.peer);
    });
    waitingOverlay.hidden = false;
  }

  /*** Self controls ***/
  function setLocalAudio(enabled) {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => t.enabled = enabled);
    toggleAudioBtn.innerHTML = enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    const badge = document.getElementById('muted-local');
    if (badge) badge.hidden = enabled;
  }

  function setLocalVideo(enabled) {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(t => t.enabled = enabled);
    toggleVideoBtn.innerHTML = enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
  }

  /*** UI wiring ***/
  securityBtn.addEventListener('click', () => {
    if (!isHost) { alert('Only host can open Security.'); return; }
    securityPanel.classList.toggle('open');
  });
  closeSecurityBtn.addEventListener('click', () => securityPanel.classList.remove('open'));
  toggleAudioBtn.addEventListener('click', () => {
    const track = localStream?.getAudioTracks?.()[0];
    const next = !(track && track.enabled);
    setLocalAudio(next);
  });
  toggleVideoBtn.addEventListener('click', () => {
    const track = localStream?.getVideoTracks?.()[0];
    const next = !(track && track.enabled);
    setLocalVideo(next);
  });
  leaveBtn.addEventListener('click', () => {
    try { peer?.destroy(); } catch (_) {}
    window.location.href = 'index.html';
  });

  /*** Host broadcast helpers ***/
  function broadcastMeshList() {
    if (!isHost) return;
    const list = [...peerIdToData.keys()].filter(pid => pid !== peer.id);
    peerIdToData.forEach((conn, pid) => {
      if (pid === peer.id) return;
      if (conn.open) conn.send({ type: 'mesh-list', peers: list });
    });
  }

  // Host listens for new incoming data connections to manage waiting room and broadcast mesh
  function wireHostPeerEvents() {
    if (!isHost) return;
    peer.on('connection', (conn) => {
      setupDataConnection(conn);
      // Put guests into waiting by default
      waitingQueue.set(conn.peer, { name: 'Guest' });
      updateWaitingList();
    });
  }

  /*** Bootstrap ***/
  (async function start() {
    loadBootstrapData();
    await ensureLocalMedia();
    createPeer();
    wireHostPeerEvents();

    // If host, hide waiting overlay
    waitingOverlay.hidden = isHost;

    // If host, keep broadcasting mesh list every few seconds
    if (isHost) {
      setInterval(broadcastMeshList, 3000);
    }
  })();
})();


