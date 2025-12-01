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
  
  // Track local state to sync with others
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
  const securityPanel = document.getElementById('security-panel');
  const securityBtn = document.getElementById('security-btn'); // Added reference
  const authModal = document.getElementById('auth-modal');
  const toast = document.getElementById('toast');
  const chatInput = document.getElementById('chat-input');
  const sendMsgBtn = document.getElementById('send-msg-btn');
  const chatMessages = document.getElementById('chat-messages');
  
  // Initialize meeting
  async function initMeeting() {
    try {
      // Get meeting data from localStorage
      const storedData = localStorage.getItem('meetingData');
      if (!storedData) {
        showToast('Meeting data not found. Redirecting to home...');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 2000);
        return;
      }
      
      meetingData = JSON.parse(storedData);
      isHost = meetingData.isHost;
      
      // Display meeting info
      ipAddressEl.textContent = meetingData.hostIP || 'Unknown';
      meetingIdEl.textContent = meetingData.meetingID;
      
      // Show/hide host-specific elements IMMEDIATELY
      updateHostUI();

      // Initialize PeerJS
      await initializePeerJS();
      
      // Get user media
      await getUserMedia();
      
      // Set up event listeners
      setupEventListeners();
      
      // If host, start listening for connections
      if (isHost) {
        startListeningForConnections();
      } else {
        // If participant, connect to host
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
        if (typeof Peer === 'undefined') {
          throw new Error('PeerJS library failed to load');
        }
        
        // Create a new peer with the stored peer ID
        peer = new Peer(meetingData.peerId, {
          debug: 0,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });
        
        peer.on('open', function(id) {
          console.log('PeerJS connection opened with ID:', id);
          resolve();
        });
        
        peer.on('error', function(err) {
          console.error('PeerJS error:', err);
          reject(err);
        });
        
        peer.on('connection', function(conn) {
          console.log('Incoming connection from:', conn.peer);
          handleIncomingConnection(conn);
        });
        
        peer.on('call', function(call) {
          console.log('Incoming call from:', call.peer);
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
      
      // Display local video
      hostVideo.srcObject = localStream;

      // Update initial state based on stream
      localState.audio = localStream.getAudioTracks()[0].enabled;
      localState.video = localStream.getVideoTracks()[0].enabled;

      // Update local icons
      updateStatusIcon('host', 'audio', localState.audio);
      updateStatusIcon('host', 'video', localState.video);

    } catch (error) {
      console.error('Error getting user media:', error);
      showToast('Failed to access camera and microphone');
    }
  }
  
  // Set up event listeners
  function setupEventListeners() {
    // Control buttons
    document.getElementById('mic-btn').addEventListener('click', toggleMicrophone);
    document.getElementById('video-btn').addEventListener('click', toggleVideo);
    document.getElementById('screen-share-btn').addEventListener('click', toggleScreenShare);
    document.getElementById('leave-btn').addEventListener('click', leaveMeeting);
    
    // Panel buttons
    document.getElementById('participants-btn').addEventListener('click', () => {
      togglePanel(participantsPanel);
    });

    document.getElementById('chat-btn').addEventListener('click', () => {
        togglePanel(chatPanel);
        setTimeout(() => chatInput.focus(), 100);
    });
    
    // Only add security listener if host
    if (securityBtn) {
        securityBtn.addEventListener('click', () => {
          if (isHost) {
            togglePanel(securityPanel);
          } else {
            showToast('Security options are only available to the host');
          }
        });
    }
    
    // Close panel buttons
    document.querySelectorAll('.close-panel').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.getAttribute('data-panel');
        document.getElementById(panelId).classList.remove('active');
      });
    });

    // Chat Send Logic
    sendMsgBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // Security options
    document.getElementById('waiting-room-toggle').addEventListener('change', (e) => {
      waitingRoomEnabled = e.target.checked;
      showToast(`Waiting room ${waitingRoomEnabled ? 'enabled' : 'disabled'}`);
    });
    
    document.getElementById('lock-meeting-toggle').addEventListener('change', (e) => {
      meetingLocked = e.target.checked;
      showToast(`Meeting ${meetingLocked ? 'locked' : 'unlocked'}`);
    });
    
    // Authentication modal buttons
    document.getElementById('admit-entry').addEventListener('click', () => {
      admitParticipant();
    });
    
    document.getElementById('deny-entry').addEventListener('click', () => {
      denyParticipant();
    });
  }

  // --- STATE SYNC FUNCTIONS (NEW) ---

  // Send state update to others
  function broadcastStateChange(type, isEnabled) {
    const data = {
        type: 'state-update',
        participantId: peer.id,
        subType: type, // 'audio' or 'video'
        status: isEnabled
    };

    if (isHost) {
        // Host broadcasts to all
        broadcastMessage(data); 
    } else {
        // Client sends to Host (Host will broadcast)
        if (peer.connections[meetingData.hostPeerId]) {
            const conns = peer.connections[meetingData.hostPeerId];
            if(conns && conns.length > 0) {
                conns[0].send(data);
            }
        }
    }
  }

  // Handle incoming state updates
  function handleStateUpdate(data) {
    // 1. Update the UI for this participant
    updateStatusIcon(data.participantId, data.subType, data.status);
    
    // 2. If Host, relay to everyone else so they also update
    if (isHost) {
        broadcastMessage(data, data.participantId); // Don't send back to sender
    }
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
             if(conns && conns.length > 0) {
                 conns[0].send(messageData);
             }
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

  // Host function to send data to all participants
  function broadcastMessage(data, excludePeerId = null) {
      Object.values(participants).forEach(p => {
          if (p.conn && p.conn.open && p.id !== excludePeerId) {
              p.conn.send(data);
          }
      });
  }
  
  // Update UI based on host status
  function updateHostUI() {
    if (!isHost) {
      // STRICTLY Hide security button for participants
      if(securityBtn) {
          securityBtn.style.display = 'none';
          securityBtn.remove(); // Completely remove from DOM to be safe
      }
      
      // Update host video label
      document.querySelector('.host-video .participant-name').textContent = meetingData.username;
      
      // Disable mute button for participants (Optional: kept based on your original logic)
      // If you want participants to mute themselves, remove the disabled attribute lines below
      // document.getElementById('mic-btn').disabled = true;
      // document.getElementById('mic-btn').style.opacity = '0.5';
    }
  }
  
  // Start listening for connections (host only)
  function startListeningForConnections() {
    if (!isHost) return;
    console.log('Host is listening for connections...');
  }
  
  // Connect to host (participant only)
  function connectToHost() {
    if (isHost) return;
    
    try {
      const conn = peer.connect(meetingData.hostPeerId);
      
      conn.on('open', function() {
        console.log('Connected to host:', meetingData.hostPeerId);
        
        // Send join request to host with INITIAL STATE
        conn.send({
          type: 'join-request',
          participantId: peer.id,
          username: meetingData.username,
          ip: meetingData.hostIP,
          initialState: localState // Send state immediately
        });
      });
      
      conn.on('data', function(data) {
        handleHostMessage(data);
      });
      
      conn.on('error', function(err) {
        console.error('Connection error:', err);
        showToast('Failed to connect to host');
      });
    } catch (error) {
      console.error('Error connecting to host:', error);
      showToast('Failed to connect to host');
    }
  }
  
  // Handle incoming connection (host only)
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
        
        if (waitingRoomEnabled) {
          showAuthModal(data);
        } else {
          admitParticipantById(conn.peer);
        }
      } else if (data.type === 'chat') {
          addMessageToChat(data, false);
          broadcastMessage(data, conn.peer);
      } else if (data.type === 'state-update') {
          handleStateUpdate(data);
      }
    });
  }
  
  // Handle incoming call
  function handleIncomingCall(call) {
    call.answer(localStream);
    
    call.on('stream', function(remoteStream) {
      // Determine name - if we are host, look up pending/participants, else it's Host
      let name = 'Participant';
      let initialState = { audio: true, video: true };

      if(isHost) {
          if(participants[call.peer]) {
              name = participants[call.peer].username;
              initialState = participants[call.peer].initialState;
          }
      } else {
          name = 'Host'; 
          // Note: Host initial state syncing is harder without a handshake, 
          // assume true until an update comes or modify handshake.
      }

      addVideoToGrid(call.peer, remoteStream, name, initialState);
    });
    
    call.on('close', function() {
      removeVideoFromGrid(call.peer);
    });
  }
  
  // Handle messages from host (participant only)
  function handleHostMessage(data) {
    if (isHost) return;
    
    switch (data.type) {
      case 'admitted':
        showToast('You have been admitted to the meeting');
        callHost();
        break;
      case 'denied':
        showToast('Your request to join was denied');
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
        break;
      case 'mute':
        if (localStream) {
          localStream.getAudioTracks().forEach(track => track.enabled = false);
          updateMicButton(false);
          updateStatusIcon('host', 'audio', false);
          localState.audio = false; // Update local state tracker
          broadcastStateChange('audio', false); // Notify others
          showToast('You have been muted by the host');
        }
        break;
      case 'kicked':
        showToast('You have been removed from the meeting');
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
        break;
      case 'chat':
        addMessageToChat(data, false);
        break;
      case 'state-update':
        handleStateUpdate(data);
        break;
    }
  }
  
  // Call host to establish media connection
  function callHost() {
    if (isHost) return;
    
    try {
      const call = peer.call(meetingData.hostPeerId, localStream);
      
      call.on('stream', function(remoteStream) {
        addVideoToGrid(meetingData.hostPeerId, remoteStream, 'Host');
      });
      
      call.on('close', function() {
        removeVideoFromGrid(meetingData.hostPeerId);
      });
    } catch (error) {
      console.error('Error calling host:', error);
    }
  }
  
  function showAuthModal(participantData) {
    document.getElementById('waiting-name').textContent = participantData.username;
    document.getElementById('waiting-ip').textContent = `IP: ${participantData.ip}`;
    authModal.classList.add('active');
    authModal.dataset.participantId = participantData.participantId;
  }
  
  function admitParticipant() {
    const participantId = authModal.dataset.participantId;
    admitParticipantById(participantId);
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
    const participantId = authModal.dataset.participantId;
    if (pendingParticipants[participantId]) {
      const { conn, username } = pendingParticipants[participantId];
      conn.send({ type: 'denied' });
      conn.close();
      delete pendingParticipants[participantId];
      showToast(`${username} was denied entry`);
    }
    authModal.classList.remove('active');
  }
  
  function updateParticipantsList() {
    const participantsList = document.getElementById('participants-list');
    const securityParticipantsList = document.getElementById('security-participants-list');
    
    participantsList.innerHTML = '';
    securityParticipantsList.innerHTML = '';
    
    const hostItem = createParticipantItem({
      id: peer.id,
      username: isHost ? 'You (Host)' : meetingData.username,
      ip: meetingData.hostIP,
      isHost: true
    });
    
    participantsList.appendChild(hostItem);
    
    if (isHost) {
      securityParticipantsList.appendChild(hostItem.cloneNode(true));
    }
    
    Object.values(participants).forEach(participant => {
      const participantItem = createParticipantItem(participant);
      participantsList.appendChild(participantItem);
      
      if (isHost) {
        const securityItem = createParticipantItem(participant, true);
        securityParticipantsList.appendChild(securityItem);
      }
    });
  }
  
  function createParticipantItem(participant, showActions = false) {
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
    
    if (isHost && participant.ip) {
      const ip = document.createElement('div');
      ip.className = 'participant-ip';
      ip.textContent = `IP: ${participant.ip}`;
      ip.style.fontSize = '12px';
      ip.style.color = 'var(--text-secondary)';
      ip.style.marginTop = '4px';
      leftDiv.appendChild(ip);
    }
    
    if (showActions && isHost && !participant.isHost) {
      const rightDiv = document.createElement('div');
      rightDiv.className = 'participant-item-right';
      
      const muteBtn = document.createElement('button');
      muteBtn.className = 'participant-action-btn';
      muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
      muteBtn.title = 'Mute';
      muteBtn.addEventListener('click', () => muteParticipant(participant.id));
      
      const kickBtn = document.createElement('button');
      kickBtn.className = 'participant-action-btn danger';
      kickBtn.innerHTML = '<i class="fas fa-user-times"></i>';
      kickBtn.title = 'Remove';
      kickBtn.addEventListener('click', () => kickParticipant(participant.id));
      
      rightDiv.appendChild(muteBtn);
      rightDiv.appendChild(kickBtn);
      item.appendChild(rightDiv);
    }
    
    return item;
  }
  
  function muteParticipant(participantId) {
    if (!isHost) return;
    const participant = participants[participantId];
    if (!participant) return;
    participant.conn.send({ type: 'mute' });
    participant.muted = true;
    showToast(`${participant.username} has been muted`);
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
    showToast(`${participant.username} has been removed from the meeting`);
  }
  
  // Add video to grid
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
    if (video) {
      video.srcObject = stream;
    }

    // Apply initial state if provided
    if (initialState) {
        updateStatusIcon(participantId, 'audio', initialState.audio);
        updateStatusIcon(participantId, 'video', initialState.video);
    }
  }
  
  function removeVideoFromGrid(participantId) {
    const videoContainer = document.getElementById(`video-${participantId}`);
    if (videoContainer) {
      videoContainer.remove();
    }
  }
  
  // Toggle microphone
  function toggleMicrophone() {
    if (!localStream) return;
    
    // Allow everyone to mute/unmute themselves now
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const enabled = !audioTracks[0].enabled;
      audioTracks[0].enabled = enabled;
      localState.audio = enabled;
      
      updateMicButton(enabled);
      updateStatusIcon('host', 'audio', enabled);
      broadcastStateChange('audio', enabled); // Broadcast change
    }
  }
  
  // Update microphone button
  function updateMicButton(enabled) {
    const micBtn = document.getElementById('mic-btn');
    const icon = micBtn.querySelector('i');
    if (enabled) {
      icon.className = 'fas fa-microphone';
      micBtn.classList.remove('active');
    } else {
      icon.className = 'fas fa-microphone-slash';
      micBtn.classList.add('active');
    }
  }
  
  // Toggle video
  function toggleVideo() {
    if (!localStream) return;
    
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const enabled = !videoTracks[0].enabled;
      videoTracks[0].enabled = enabled;
      localState.video = enabled;

      updateVideoButton(enabled);
      updateStatusIcon('host', 'video', enabled);
      broadcastStateChange('video', enabled); // Broadcast change
    }
  }
  
  function updateVideoButton(enabled) {
    const videoBtn = document.getElementById('video-btn');
    const icon = videoBtn.querySelector('i');
    if (enabled) {
      icon.className = 'fas fa-video';
      videoBtn.classList.remove('active');
    } else {
      icon.className = 'fas fa-video-slash';
      videoBtn.classList.add('active');
    }
  }

  // Helper to update specific icon for any participant
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
  
  function toggleScreenShare() {
    showToast('Screen sharing is not yet implemented');
  }
  
  function leaveMeeting() {
    if (confirm('Are you sure you want to leave the meeting?')) {
      if (peer && !peer.destroyed) {
        peer.destroy();
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      localStorage.removeItem('meetingData');
      window.location.href = 'index.html';
    }
  }
  
  function togglePanel(panel) {
    document.querySelectorAll('.side-panel').forEach(p => {
      if (p !== panel) {
        p.classList.remove('active');
      }
    });
    panel.classList.toggle('active');
  }
  
  function showToast(message) {
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
  
  initMeeting();
});