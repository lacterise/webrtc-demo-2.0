document.addEventListener('DOMContentLoaded', function() {
  // Global variables
  let peer;
  let localStream;
  let meetingData;
  let participants = {};
  let isHost = false;
  let waitingRoomEnabled = true;
  let meetingLocked = false;
  let pendingParticipants = {};
  
  // Track local state
  let localState = {
    audio: true,
    video: true
  };
  
  // DOM elements
  const ipAddressEl = document.getElementById('ip-address');
  const meetingIdEl = document.getElementById('meeting-id');
  const videoGrid = document.getElementById('video-grid');
  const hostVideo = document.getElementById('host-video');
  const participantsPanel = document.getElementById('participants-panel');
  const chatPanel = document.getElementById('chat-panel');
  
  // These might be removed for clients, so we query them safely later or handle nulls
  let securityPanel = document.getElementById('security-panel');
  let securityBtn = document.getElementById('security-btn'); 
  
  const authModal = document.getElementById('auth-modal');
  const toast = document.getElementById('toast');
  const chatInput = document.getElementById('chat-input');
  const sendMsgBtn = document.getElementById('send-msg-btn');
  const chatMessages = document.getElementById('chat-messages');
  
  // Initialize meeting
  async function initMeeting() {
    try {
      const storedData = localStorage.getItem('meetingData');
      if (!storedData) {
        showToast('Meeting data not found. Redirecting to home...');
        setTimeout(() => window.location.href = 'index.html', 2000);
        return;
      }
      
      meetingData = JSON.parse(storedData);
      isHost = meetingData.isHost;
      
      ipAddressEl.textContent = meetingData.hostIP || 'Unknown';
      meetingIdEl.textContent = meetingData.meetingID;
      
      // 1. UPDATE UI permissions IMMEDIATELY
      updateHostUI();

      await initializePeerJS();
      await getUserMedia();
      setupEventListeners();
      
      if (isHost) {
        startListeningForConnections();
      } else {
        connectToHost();
      }
      
      showToast(`Welcome to the meeting, ${meetingData.username}!`);
    } catch (error) {
      console.error('Error initializing meeting:', error);
      showToast('Failed to initialize meeting. Please try again.');
    }
  }
  
  // Initialize PeerJS
  async function initializePeerJS() {
    return new Promise((resolve, reject) => {
      try {
        if (typeof Peer === 'undefined') throw new Error('PeerJS library failed to load');
        
        peer = new Peer(meetingData.peerId, {
          debug: 0,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });
        
        peer.on('open', (id) => {
          console.log('PeerJS connection opened with ID:', id);
          resolve();
        });
        
        peer.on('error', (err) => {
          console.error('PeerJS error:', err);
          reject(err);
        });
        
        peer.on('connection', (conn) => {
          handleIncomingConnection(conn);
        });
        
        peer.on('call', (call) => {
          handleIncomingCall(call);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // Get user media
  async function getUserMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      hostVideo.srcObject = localStream;

      // Initial State
      localState.audio = localStream.getAudioTracks()[0].enabled;
      localState.video = localStream.getVideoTracks()[0].enabled;

      // If Client: Force Audio OFF by default if you want them muted on join
      // Or keep it ON but remove controls. 
      // User said "participants can't mute themselves", implying Host has control.
      
      updateStatusIcon('host', 'audio', localState.audio);
      updateStatusIcon('host', 'video', localState.video);

    } catch (error) {
      console.error('Error getting user media:', error);
      showToast('Failed to access camera and microphone');
    }
  }
  
  function setupEventListeners() {
    // Shared Controls
    document.getElementById('video-btn').addEventListener('click', toggleVideo);
    document.getElementById('screen-share-btn').addEventListener('click', () => showToast('Screen sharing coming soon'));
    document.getElementById('leave-btn').addEventListener('click', leaveMeeting);
    
    // Mic Button: Only attach listener if button exists (Host only)
    const micBtn = document.getElementById('mic-btn');
    if (micBtn && micBtn.style.display !== 'none') {
        micBtn.addEventListener('click', toggleMicrophone);
    }
    
    // Panels
    document.getElementById('participants-btn').addEventListener('click', () => togglePanel(participantsPanel));
    
    document.getElementById('chat-btn').addEventListener('click', () => {
        togglePanel(chatPanel);
        setTimeout(() => chatInput.focus(), 100);
    });
    
    // SECURITY BUTTON - Only add listener if it exists (Host only)
    securityBtn = document.getElementById('security-btn');
    if (securityBtn) {
        securityBtn.addEventListener('click', () => {
             // Redundant check, but safe
             if (isHost) togglePanel(document.getElementById('security-panel'));
        });
    }
    
    // Close panel buttons
    document.querySelectorAll('.close-panel').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.getAttribute('data-panel');
        const p = document.getElementById(panelId);
        if(p) p.classList.remove('active');
      });
    });

    // Chat
    sendMsgBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // Host Security Options
    if(isHost) {
        document.getElementById('waiting-room-toggle').addEventListener('change', (e) => {
            waitingRoomEnabled = e.target.checked;
            showToast(`Waiting room ${waitingRoomEnabled ? 'enabled' : 'disabled'}`);
        });
        
        document.getElementById('lock-meeting-toggle').addEventListener('change', (e) => {
            meetingLocked = e.target.checked;
            showToast(`Meeting ${meetingLocked ? 'locked' : 'unlocked'}`);
        });
        
        document.getElementById('admit-entry').addEventListener('click', admitParticipant);
        document.getElementById('deny-entry').addEventListener('click', denyParticipant);
    }
  }

  // --- STATE SYNC & CONTROL ---

  // Host sends this to force a client's state
  function sendForceState(participantId, type, enabled) {
      const p = participants[participantId];
      if (p && p.conn) {
          p.conn.send({
              type: 'force-state',
              subType: type,
              enabled: enabled
          });
      }
  }

  // Everyone sends this when their state changes manually
  function broadcastStateChange(type, isEnabled) {
    const data = {
        type: 'state-update',
        participantId: peer.id,
        subType: type,
        status: isEnabled
    };

    if (isHost) {
        broadcastMessage(data); 
    } else {
        if (peer.connections[meetingData.hostPeerId]) {
            const conns = peer.connections[meetingData.hostPeerId];
            if(conns && conns.length > 0) conns[0].send(data);
        }
    }
  }

  function handleStateUpdate(data) {
    updateStatusIcon(data.participantId, data.subType, data.status);
    
    // If Host receives update, update the "Mute/Unmute" button text/icon in Security tab
    if (isHost && data.subType === 'audio') {
        updateSecurityTabButton(data.participantId, data.status);
    }

    if (isHost) broadcastMessage(data, data.participantId);
  }

  // --- CHAT FUNCTIONS ---

  function sendChatMessage() {
      const text = chatInput.value.trim();
      if (!text) return;

      const messageData = {
          type: 'chat',
          sender: meetingData.username,
          message: text,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      addMessageToChat(messageData, true);

      if (isHost) {
          broadcastMessage(messageData);
      } else {
          if (peer.connections[meetingData.hostPeerId]) {
             const conns = peer.connections[meetingData.hostPeerId];
             if(conns && conns.length > 0) conns[0].send(messageData);
          }
      }
      chatInput.value = '';
  }

  function addMessageToChat(data, isSelf = false) {
      const wrapper = document.createElement('div');
      wrapper.className = `message-wrapper ${isSelf ? 'self' : 'other'}`;
      let html = `<div class="message-sender">${data.sender}</div>`;
      html += `
          <div class="message-bubble">${data.message}</div>
          <div class="message-time">${data.time}</div>
      `;
      wrapper.innerHTML = html;
      chatMessages.appendChild(wrapper);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if(!chatPanel.classList.contains('active') && !isSelf) {
          const chatBtn = document.getElementById('chat-btn');
          chatBtn.classList.add('active'); 
          setTimeout(() => chatBtn.classList.remove('active'), 1000);
      }
  }

  function broadcastMessage(data, excludePeerId = null) {
      Object.values(participants).forEach(p => {
          if (p.conn && p.conn.open && p.id !== excludePeerId) {
              p.conn.send(data);
          }
      });
  }
  
  // Update UI permissions
  function updateHostUI() {
    if (!isHost) {
      // 1. COMPLETELY REMOVE Security Button & Panel for Participants
      const secBtn = document.getElementById('security-btn');
      if (secBtn) secBtn.remove();
      
      const secPanel = document.getElementById('security-panel');
      if (secPanel) secPanel.remove();
      
      // 2. Hide Mic Button (Participants can't mute themselves)
      const micBtn = document.getElementById('mic-btn');
      if (micBtn) {
          micBtn.style.display = 'none'; // Hide it
      }
      
      document.querySelector('.host-video .participant-name').textContent = meetingData.username;
    }
  }
  
  function startListeningForConnections() {
    if (!isHost) return;
    console.log('Host listening...');
  }
  
  function connectToHost() {
    if (isHost) return;
    try {
      const conn = peer.connect(meetingData.hostPeerId);
      conn.on('open', function() {
        conn.send({
          type: 'join-request',
          participantId: peer.id,
          username: meetingData.username,
          ip: meetingData.hostIP, // Sending own IP to host
          initialState: localState
        });
      });
      conn.on('data', handleHostMessage);
    } catch (error) {
      console.error(error);
    }
  }
  
  function handleIncomingConnection(conn) {
    if (!isHost) return;
    
    conn.on('data', function(data) {
      if (data.type === 'join-request') {
        pendingParticipants[conn.peer] = {
          conn: conn,
          participantId: data.participantId,
          username: data.username,
          ip: data.ip,
          initialState: data.initialState || { audio: true, video: true }
        };
        
        if (waitingRoomEnabled) showAuthModal(data);
        else admitParticipantById(conn.peer);

      } else if (data.type === 'chat') {
          addMessageToChat(data, false);
          broadcastMessage(data, conn.peer);
      } else if (data.type === 'state-update') {
          handleStateUpdate(data);
      }
    });
  }
  
  function handleIncomingCall(call) {
    call.answer(localStream);
    
    call.on('stream', function(remoteStream) {
      let name = 'Participant';
      let initialState = { audio: true, video: true };

      if(isHost) {
          if(participants[call.peer]) {
              name = participants[call.peer].username;
              initialState = participants[call.peer].initialState;
          }
      } else {
          name = 'Host'; 
      }
      addVideoToGrid(call.peer, remoteStream, name, initialState);
    });
    
    call.on('close', function() {
      removeVideoFromGrid(call.peer);
    });
  }
  
  function handleHostMessage(data) {
    if (isHost) return;
    
    switch (data.type) {
      case 'admitted':
        showToast('You have been admitted to the meeting');
        callHost();
        break;
      case 'denied':
        showToast('Your request to join was denied');
        setTimeout(() => window.location.href = 'index.html', 2000);
        break;
      case 'force-state':
        // Host controlling our mic
        if (data.subType === 'audio') {
            if (localStream) {
                localStream.getAudioTracks().forEach(t => t.enabled = data.enabled);
                localState.audio = data.enabled;
                // Update local icon (even if button is hidden)
                updateStatusIcon('host', 'audio', data.enabled);
                // Notify everyone else
                broadcastStateChange('audio', data.enabled);
                
                const statusMsg = data.enabled ? 'unmuted' : 'muted';
                showToast(`You have been ${statusMsg} by the host`);
            }
        }
        break;
      case 'kicked':
        showToast('You have been removed from the meeting');
        setTimeout(() => window.location.href = 'index.html', 2000);
        break;
      case 'chat':
        addMessageToChat(data, false);
        break;
      case 'state-update':
        handleStateUpdate(data);
        break;
    }
  }
  
  function callHost() {
    if (isHost) return;
    const call = peer.call(meetingData.hostPeerId, localStream);
    call.on('stream', (remoteStream) => addVideoToGrid(meetingData.hostPeerId, remoteStream, 'Host'));
    call.on('close', () => removeVideoFromGrid(meetingData.hostPeerId));
  }
  
  function showAuthModal(participantData) {
    document.getElementById('waiting-name').textContent = participantData.username;
    document.getElementById('waiting-ip').textContent = `IP: ${participantData.ip}`;
    authModal.classList.add('active');
    authModal.dataset.participantId = participantData.participantId;
  }
  
  function admitParticipant() {
    const pId = authModal.dataset.participantId;
    admitParticipantById(pId);
    authModal.classList.remove('active');
  }
  
  function admitParticipantById(participantId) {
    if (!pendingParticipants[participantId]) return;
    const { conn, username, ip, initialState } = pendingParticipants[participantId];
    
    conn.send({ type: 'admitted' });
    
    participants[participantId] = {
      id: participantId,
      username: username,
      ip: ip,
      conn: conn,
      muted: false,
      initialState: initialState
    };
    
    updateParticipantsList();
    delete pendingParticipants[participantId];
    showToast(`${username} has joined the meeting`);
  }
  
  function denyParticipant() {
    const pId = authModal.dataset.participantId;
    if (pendingParticipants[pId]) {
      pendingParticipants[pId].conn.send({ type: 'denied' });
      pendingParticipants[pId].conn.close();
      delete pendingParticipants[pId];
    }
    authModal.classList.remove('active');
  }
  
  function updateParticipantsList() {
    const participantsList = document.getElementById('participants-list');
    const securityParticipantsList = document.getElementById('security-participants-list');
    
    participantsList.innerHTML = '';
    if(securityParticipantsList) securityParticipantsList.innerHTML = '';
    
    // NOTE: We do NOT add the Host to the lists based on request.
    
    Object.values(participants).forEach(participant => {
      // 1. Add to General Participants List (Visible to all)
      // They see: Avatar, Name, IP
      const participantItem = createParticipantItem(participant, false);
      participantsList.appendChild(participantItem);
      
      // 2. Add to Security List (Host only) - Includes Management Controls
      if (isHost && securityParticipantsList) {
        const securityItem = createParticipantItem(participant, true);
        securityParticipantsList.appendChild(securityItem);
      }
    });
  }
  
  function createParticipantItem(participant, isSecurityTab = false) {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.dataset.participantId = participant.id;
    
    const leftDiv = document.createElement('div');
    leftDiv.className = 'participant-item-left';
    
    const avatar = document.createElement('div');
    avatar.className = 'participant-avatar';
    avatar.innerHTML = '<i class="fas fa-user"></i>';
    
    const name = document.createElement('div');
    name.className = 'participant-name';
    name.textContent = participant.username;
    
    leftDiv.appendChild(avatar);
    leftDiv.appendChild(name);
    
    // Show IP for everyone in the list (Educational purposes)
    if (participant.ip) {
      const ip = document.createElement('div');
      ip.className = 'participant-ip';
      ip.textContent = `IP: ${participant.ip}`;
      ip.style.fontSize = '12px';
      ip.style.color = 'var(--text-secondary)';
      ip.style.marginTop = '4px';
      leftDiv.appendChild(ip);
    }
    
    item.appendChild(leftDiv);
    
    // Add CONTROLS only if this is the Security Tab (Host management)
    if (isSecurityTab && isHost) {
      const rightDiv = document.createElement('div');
      rightDiv.className = 'participant-item-right';
      
      // Mute/Unmute Button (Toggle)
      const micBtn = document.createElement('button');
      micBtn.className = 'participant-action-btn';
      micBtn.id = `sec-mic-${participant.id}`;
      
      // Set initial icon based on state
      const isMuted = participant.initialState && !participant.initialState.audio;
      micBtn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash" style="color:red"></i>' : '<i class="fas fa-microphone"></i>';
      micBtn.title = isMuted ? 'Unmute' : 'Mute';
      
      micBtn.addEventListener('click', () => {
         // Check current visual state to determine action
         const currentIcon = micBtn.querySelector('i').classList.contains('fa-microphone-slash');
         // If currently slash (muted), we want to UNMUTE (enable=true).
         // If currently mic (unmuted), we want to MUTE (enable=false).
         const newState = currentIcon; // true = enable audio
         toggleParticipantMute(participant.id, newState);
      });
      
      // Kick button
      const kickBtn = document.createElement('button');
      kickBtn.className = 'participant-action-btn danger';
      kickBtn.innerHTML = '<i class="fas fa-user-times"></i>';
      kickBtn.title = 'Remove';
      kickBtn.addEventListener('click', () => kickParticipant(participant.id));
      
      rightDiv.appendChild(micBtn);
      rightDiv.appendChild(kickBtn);
      item.appendChild(rightDiv);
    }
    
    return item;
  }
  
  // Update the button in security tab when state changes
  function updateSecurityTabButton(participantId, isAudioEnabled) {
      const btn = document.getElementById(`sec-mic-${participantId}`);
      if(btn) {
          if(isAudioEnabled) {
             btn.innerHTML = '<i class="fas fa-microphone"></i>';
             btn.title = 'Mute';
          } else {
             btn.innerHTML = '<i class="fas fa-microphone-slash" style="color:red"></i>';
             btn.title = 'Unmute';
          }
      }
  }

  function toggleParticipantMute(participantId, enableAudio) {
    if (!isHost) return;
    const participant = participants[participantId];
    if (!participant) return;
    
    // Send force command
    sendForceState(participantId, 'audio', enableAudio);
    
    // Update local UI immediately (optimistic)
    updateSecurityTabButton(participantId, enableAudio);
  }
  
  function kickParticipant(participantId) {
    if (!isHost) return;
    const participant = participants[participantId];
    if (!participant) return;
    
    participant.conn.send({ type: 'kicked' });
    participant.conn.close();
    delete participants[participantId];
    updateParticipantsList();
    removeVideoFromGrid(participantId);
    showToast(`${participant.username} has been removed`);
  }
  
  function addVideoToGrid(participantId, stream, name = '', initialState = null) {
    let videoContainer = document.getElementById(`video-${participantId}`);
    
    if (!videoContainer) {
      videoContainer = document.createElement('div');
      videoContainer.className = 'video-container';
      videoContainer.id = `video-${participantId}`;
      
      const video = document.createElement('video');
      video.id = `video-stream-${participantId}`;
      video.autoplay = true;
      video.playsinline = true;
      
      const videoInfo = document.createElement('div');
      videoInfo.className = 'video-info';
      
      const participantName = document.createElement('span');
      participantName.className = 'participant-name';
      participantName.textContent = name || participants[participantId]?.username || 'Unknown';
      
      const participantStatus = document.createElement('div');
      participantStatus.className = 'participant-status';
      participantStatus.innerHTML = `
        <i class="fas fa-microphone"></i>
        <i class="fas fa-video"></i>
      `;
      
      videoInfo.appendChild(participantName);
      videoInfo.appendChild(participantStatus);
      videoContainer.appendChild(video);
      videoContainer.appendChild(videoInfo);
      videoGrid.appendChild(videoContainer);
    }
    
    const video = document.getElementById(`video-stream-${participantId}`);
    if (video) video.srcObject = stream;

    if (initialState) {
        updateStatusIcon(participantId, 'audio', initialState.audio);
        updateStatusIcon(participantId, 'video', initialState.video);
        // Also update Security Tab if exists
        updateSecurityTabButton(participantId, initialState.audio);
    }
  }
  
  function removeVideoFromGrid(participantId) {
    const v = document.getElementById(`video-${participantId}`);
    if (v) v.remove();
  }
  
  function toggleMicrophone() {
    if (!localStream) return;
    // Only works for Host now as Client button is hidden
    const tracks = localStream.getAudioTracks();
    if (tracks.length > 0) {
      const enabled = !tracks[0].enabled;
      tracks[0].enabled = enabled;
      localState.audio = enabled;
      
      const micBtn = document.getElementById('mic-btn');
      const icon = micBtn.querySelector('i');
      if (enabled) {
        icon.className = 'fas fa-microphone';
        micBtn.classList.remove('active');
      } else {
        icon.className = 'fas fa-microphone-slash';
        micBtn.classList.add('active');
      }
      
      updateStatusIcon('host', 'audio', enabled);
      broadcastStateChange('audio', enabled);
    }
  }
  
  function toggleVideo() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (tracks.length > 0) {
      const enabled = !tracks[0].enabled;
      tracks[0].enabled = enabled;
      localState.video = enabled;

      const videoBtn = document.getElementById('video-btn');
      const icon = videoBtn.querySelector('i');
      if (enabled) {
        icon.className = 'fas fa-video';
        videoBtn.classList.remove('active');
      } else {
        icon.className = 'fas fa-video-slash';
        videoBtn.classList.add('active');
      }

      updateStatusIcon('host', 'video', enabled);
      broadcastStateChange('video', enabled);
    }
  }

  function updateStatusIcon(participantId, type, isEnabled) {
    const containerId = participantId === 'host' ? 'host-video-container' : `video-${participantId}`;
    const container = document.getElementById(containerId);
    if (!container) return;
  
    const statusContainer = container.querySelector('.participant-status');
    if (!statusContainer) return;
  
    const icon = type === 'audio' 
      ? statusContainer.querySelector('.fa-microphone, .fa-microphone-slash')
      : statusContainer.querySelector('.fa-video, .fa-video-slash');
  
    if (icon) {
      if (isEnabled) {
        icon.className = type === 'audio' ? 'fas fa-microphone' : 'fas fa-video';
        icon.classList.remove('muted-icon');
      } else {
        icon.className = type === 'audio' ? 'fas fa-microphone-slash' : 'fas fa-video-slash';
        icon.classList.add('muted-icon');
      }
    }
  }
  
  function leaveMeeting() {
    if (confirm('Are you sure you want to leave?')) {
      if (peer && !peer.destroyed) peer.destroy();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      localStorage.removeItem('meetingData');
      window.location.href = 'index.html';
    }
  }
  
  function togglePanel(panel) {
    if(!panel) return;
    document.querySelectorAll('.side-panel').forEach(p => {
      if (p !== panel) p.classList.remove('active');
    });
    panel.classList.toggle('active');
  }
  
  function showToast(message) {
    const t = document.getElementById('toast');
    document.getElementById('toast-message').textContent = message;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }
  
  initMeeting();
});