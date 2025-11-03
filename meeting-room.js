document.addEventListener('DOMContentLoaded', function() {
  // Global variables
  let peer;
  let localStream;
  let screenStream;
  let meetingData;
  let participants = {};
  let isHost = false;
  let waitingRoomEnabled = true;
  let meetingLocked = false;
  let pendingParticipants = {};
  let isScreenSharing = false;
  
  // DOM elements
  const ipAddressEl = document.getElementById('ip-address');
  const meetingIdEl = document.getElementById('meeting-id');
  const videoGrid = document.getElementById('video-grid');
  const hostVideo = document.getElementById('host-video');
  const participantsPanel = document.getElementById('participants-panel');
  const securityPanel = document.getElementById('security-panel');
  const chatPanel = document.getElementById('chat-panel');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const sendMessageBtn = document.getElementById('send-message-btn');
  const authModal = document.getElementById('auth-modal');
  const toast = document.getElementById('toast');
  
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
      
      // Initialize PeerJS
      await initializePeerJS();
      
      // Get user media
      await getUserMedia();
      
      // Set up event listeners
      setupEventListeners();
      
      // Show/hide host-specific elements
      updateHostUI();
      
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
      
      // Update mic button to show unmuted state
      updateMicButton(true);
    } catch (error) {
      console.error('Error getting user media:', error);
      showToast('Failed to access camera and microphone');
    }
  }
  
  // Set up event listeners
  function setupEventListeners() {
    // Control buttons
    document.getElementById('mic-btn').addEventListener('click', toggleMicrophone);
    document.getElementById('screen-share-btn').addEventListener('click', toggleScreenShare);
    document.getElementById('leave-btn').addEventListener('click', leaveMeeting);
    
    // Panel buttons
    document.getElementById('participants-btn').addEventListener('click', () => {
      togglePanel(participantsPanel);
    });
    
    document.getElementById('chat-btn').addEventListener('click', () => {
      togglePanel(chatPanel);
    });
    
    // Close panel buttons
    document.querySelectorAll('.close-panel').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.getAttribute('data-panel');
        document.getElementById(panelId).classList.remove('active');
      });
    });
    
    // Chat functionality
    sendMessageBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
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
  
  // Update UI based on host status
  function updateHostUI() {
    if (!isHost) {
      // Update host video label
      document.querySelector('.host-video .participant-name').textContent = meetingData.username;
      
      // Disable mute button for participants
      document.getElementById('mic-btn').disabled = true;
      document.getElementById('mic-btn').style.opacity = '0.5';
      document.getElementById('mic-btn').title = 'Only the host can mute/unmute';
    }
  }
  
  // Start listening for connections (host only)
  function startListeningForConnections() {
    if (!isHost) return;
    
    // Host-specific initialization
    console.log('Host is listening for connections...');
  }
  
  // Connect to host (participant only)
  function connectToHost() {
    if (isHost) return;
    
    try {
      const conn = peer.connect(meetingData.hostPeerId);
      
      conn.on('open', function() {
        console.log('Connected to host:', meetingData.hostPeerId);
        
        // Send join request to host
        conn.send({
          type: 'join-request',
          participantId: peer.id,
          username: meetingData.username,
          ip: meetingData.hostIP
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
        // Store pending participant
        pendingParticipants[conn.peer] = {
          conn: conn,
          participantId: data.participantId,
          username: data.username,
          ip: data.ip
        };
        
        // Show authentication modal if waiting room is enabled
        if (waitingRoomEnabled) {
          showAuthModal(data);
        } else {
          // Auto-admit if waiting room is disabled
          admitParticipantById(conn.peer);
        }
      } else if (data.type === 'chat-message') {
        // Relay chat message to all participants
        relayChatMessage(data);
      }
    });
  }
  
  // Handle incoming call
  function handleIncomingCall(call) {
    call.answer(localStream);
    
    call.on('stream', function(remoteStream) {
      // Add remote video to grid
      addVideoToGrid(call.peer, remoteStream);
    });
    
    call.on('close', function() {
      // Remove video from grid
      removeVideoFromGrid(call.peer);
    });
  }
  
  // Handle messages from host (participant only)
  function handleHostMessage(data) {
    if (isHost) return;
    
    switch (data.type) {
      case 'admitted':
        showToast('You have been admitted to the meeting');
        // Call the host to establish media connection
        callHost();
        break;
      case 'denied':
        showToast('Your request to join was denied');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 2000);
        break;
      case 'mute':
        // Force mute participant
        if (localStream) {
          localStream.getAudioTracks().forEach(track => track.enabled = false);
          updateMicButton(false);
          showToast('You have been muted by the host');
        }
        break;
      case 'unmute':
        // Force unmute participant
        if (localStream) {
          localStream.getAudioTracks().forEach(track => track.enabled = true);
          updateMicButton(true);
          showToast('You have been unmuted by the host');
        }
        break;
      case 'kicked':
        showToast('You have been removed from the meeting');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 2000);
        break;
      case 'chat-message':
        // Display chat message from host
        displayChatMessage(data);
        break;
    }
  }
  
  // Call host to establish media connection
  function callHost() {
    if (isHost) return;
    
    try {
      const call = peer.call(meetingData.hostPeerId, localStream);
      
      call.on('stream', function(remoteStream) {
        // Add host video to grid
        addVideoToGrid(meetingData.hostPeerId, remoteStream, 'Host');
      });
      
      call.on('close', function() {
        // Remove host video from grid
        removeVideoFromGrid(meetingData.hostPeerId);
      });
    } catch (error) {
      console.error('Error calling host:', error);
    }
  }
  
  // Show authentication modal
  function showAuthModal(participantData) {
    document.getElementById('waiting-name').textContent = participantData.username;
    document.getElementById('waiting-ip').textContent = `IP: ${participantData.ip}`;
    authModal.classList.add('active');
    
    // Store current pending participant ID
    authModal.dataset.participantId = participantData.participantId;
  }
  
  // Admit participant
  function admitParticipant() {
    const participantId = authModal.dataset.participantId;
    admitParticipantById(participantId);
    authModal.classList.remove('active');
  }
  
  // Admit participant by ID
  function admitParticipantById(participantId) {
    if (!pendingParticipants[participantId]) return;
    
    const { conn, username, ip } = pendingParticipants[participantId];
    
    // Send admission confirmation
    conn.send({
      type: 'admitted'
    });
    
    // Add to participants list
    participants[participantId] = {
      id: participantId,
      username: username,
      ip: ip,
      conn: conn,
      muted: false
    };
    
    // Update participants list
    updateParticipantsList();
    
    // Remove from pending
    delete pendingParticipants[participantId];
    
    showToast(`${username} has joined the meeting`);
    
    // Call the participant to establish media connection
    callParticipant(participantId);
  }
  
  // Call participant to establish media connection
  function callParticipant(participantId) {
    if (!isHost) return;
    
    try {
      const call = peer.call(participantId, localStream);
      
      call.on('stream', function(remoteStream) {
        // Add participant video to grid
        addVideoToGrid(participantId, remoteStream, participants[participantId].username);
      });
      
      call.on('close', function() {
        // Remove participant video from grid
        removeVideoFromGrid(participantId);
      });
    } catch (error) {
      console.error('Error calling participant:', error);
    }
  }
  
  // Deny participant
  function denyParticipant() {
    const participantId = authModal.dataset.participantId;
    
    if (pendingParticipants[participantId]) {
      const { conn, username } = pendingParticipants[participantId];
      
      // Send denial
      conn.send({
        type: 'denied'
      });
      
      // Close connection
      conn.close();
      
      // Remove from pending
      delete pendingParticipants[participantId];
      
      showToast(`${username} was denied entry`);
    }
    
    authModal.classList.remove('active');
  }
  
  // Update participants list
  function updateParticipantsList() {
    const participantsList = document.getElementById('participants-list');
    const securityParticipantsList = document.getElementById('security-participants-list');
    
    // Clear lists
    participantsList.innerHTML = '';
    securityParticipantsList.innerHTML = '';
    
    // Add host
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
    
    // Add other participants
    Object.values(participants).forEach(participant => {
      const participantItem = createParticipantItem(participant);
      participantsList.appendChild(participantItem);
      
      if (isHost) {
        const securityItem = createParticipantItem(participant, true);
        securityParticipantsList.appendChild(securityItem);
      }
    });
  }
  
  // Create participant item
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
    
    item.appendChild(leftDiv);
    
    // Add IP for host view
    if (isHost && participant.ip) {
      const ip = document.createElement('div');
      ip.className = 'participant-ip';
      ip.textContent = `IP: ${participant.ip}`;
      ip.style.fontSize = '12px';
      ip.style.color = 'var(--text-secondary)';
      ip.style.marginTop = '4px';
      leftDiv.appendChild(ip);
    }
    
    // Add actions for host
    if (showActions && isHost && !participant.isHost) {
      const rightDiv = document.createElement('div');
      rightDiv.className = 'participant-item-right';
      
      // Mute/Unmute button
      const muteBtn = document.createElement('button');
      muteBtn.className = 'participant-action-btn';
      muteBtn.innerHTML = participant.muted ? 
        '<i class="fas fa-microphone"></i>' : 
        '<i class="fas fa-microphone-slash"></i>';
      muteBtn.title = participant.muted ? 'Unmute' : 'Mute';
      muteBtn.addEventListener('click', () => toggleParticipantMute(participant.id));
      
      // Kick button
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
  
  // Toggle participant mute/unmute (host only)
  function toggleParticipantMute(participantId) {
    if (!isHost) return;
    
    const participant = participants[participantId];
    if (!participant) return;
    
    // Toggle mute state
    participant.muted = !participant.muted;
    
    // Send mute/unmute command
    participant.conn.send({
      type: participant.muted ? 'mute' : 'unmute'
    });
    
    // Update UI
    updateParticipantsList();
    
    showToast(`${participant.username} has been ${participant.muted ? 'muted' : 'unmuted'}`);
  }
  
  // Kick participant (host only)
  function kickParticipant(participantId) {
    if (!isHost) return;
    
    const participant = participants[participantId];
    if (!participant) return;
    
    // Send kick command
    participant.conn.send({
      type: 'kicked'
    });
    
    // Close connection
    participant.conn.close();
    
    // Remove from participants
    delete participants[participantId];
    
    // Update UI
    updateParticipantsList();
    removeVideoFromGrid(participantId);
    
    showToast(`${participant.username} has been removed from the meeting`);
  }
  
  // Add video to grid
  function addVideoToGrid(participantId, stream, name = '') {
    // Check if video already exists
    let videoContainer = document.getElementById(`video-${participantId}`);
    
    if (!videoContainer) {
      // Create new video container
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
        <i class="fas fa-microphone muted-icon"></i>
        <i class="fas fa-video muted-icon"></i>
      `;
      
      videoInfo.appendChild(participantName);
      videoInfo.appendChild(participantStatus);
      
      videoContainer.appendChild(video);
      videoContainer.appendChild(videoInfo);
      
      videoGrid.appendChild(videoContainer);
    }
    
    // Set video stream
    const video = document.getElementById(`video-stream-${participantId}`);
    if (video) {
      video.srcObject = stream;
    }
  }
  
  // Remove video from grid
  function removeVideoFromGrid(participantId) {
    const videoContainer = document.getElementById(`video-${participantId}`);
    if (videoContainer) {
      videoContainer.remove();
    }
  }
  
  // Toggle microphone
  function toggleMicrophone() {
    if (!localStream) return;
    
    // Participants can't toggle their own mic
    if (!isHost) {
      showToast('Only the host can mute/unmute');
      return;
    }
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const enabled = !audioTracks[0].enabled;
      audioTracks[0].enabled = enabled;
      updateMicButton(enabled);
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
  
  // Toggle screen share
  async function toggleScreenShare() {
    if (!isScreenSharing) {
      try {
        // Start screen share
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        
        // Replace video track in local stream
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = peer && peer.connections && Object.values(peer.connections)[0] && 
                      Object.values(peer.connections)[0][0] && 
                      Object.values(peer.connections)[0][0].peerConnection && 
                      Object.values(peer.connections)[0][0].peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        
        if (sender) {
          sender.replaceTrack(videoTrack);
        } else {
          // If no sender found, just display locally
          hostVideo.srcObject = screenStream;
        }
        
        // Update button
        document.getElementById('screen-share-btn').classList.add('active');
        isScreenSharing = true;
        
        // Listen for screen share end
        videoTrack.onended = () => {
          stopScreenShare();
        };
        
        showToast('Screen sharing started');
      } catch (error) {
        console.error('Error starting screen share:', error);
        showToast('Failed to start screen sharing');
      }
    } else {
      stopScreenShare();
    }
  }
  
  // Stop screen share
  function stopScreenShare() {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    
    // Restore local video
    hostVideo.srcObject = localStream;
    
    // Update button
    document.getElementById('screen-share-btn').classList.remove('active');
    isScreenSharing = false;
    
    showToast('Screen sharing stopped');
  }
  
  // Send chat message
  function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    const messageData = {
      type: 'chat-message',
      sender: meetingData.username,
      senderId: peer.id,
      content: message,
      timestamp: new Date().toISOString()
    };
    
    // Display message locally
    displayChatMessage(messageData, true);
    
    // Send to all participants
    if (isHost) {
      // Host sends to all participants
      Object.values(participants).forEach(participant => {
        participant.conn.send(messageData);
      });
    } else {
      // Participant sends to host
      const hostConn = Object.values(peer.connections)[0] && Object.values(peer.connections)[0][0];
      if (hostConn) {
        hostConn.send(messageData);
      }
    }
    
    // Clear input
    chatInput.value = '';
  }
  
  // Relay chat message to all participants (host only)
  function relayChatMessage(messageData) {
    if (!isHost) return;
    
    // Don't relay back to sender
    Object.values(participants).forEach(participant => {
      if (participant.id !== messageData.senderId) {
        participant.conn.send(messageData);
      }
    });
    
    // Display message
    displayChatMessage(messageData);
  }
  
  // Display chat message
  function displayChatMessage(messageData, isOwn = false) {
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isOwn ? 'own' : ''}`;
    
    const messageHeader = document.createElement('div');
    messageHeader.className = 'chat-message-header';
    
    const messageSender = document.createElement('span');
    messageSender.className = 'chat-message-sender';
    messageSender.textContent = messageData.sender;
    
    const messageTime = document.createElement('span');
    messageTime.className = 'chat-message-time';
    messageTime.textContent = new Date(messageData.timestamp).toLocaleTimeString();
    
    messageHeader.appendChild(messageSender);
    messageHeader.appendChild(messageTime);
    
    const messageContent = document.createElement('div');
    messageContent.className = 'chat-message-content';
    messageContent.textContent = messageData.content;
    
    messageElement.appendChild(messageHeader);
    messageElement.appendChild(messageContent);
    
    chatMessages.appendChild(messageElement);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
  // Leave meeting
  function leaveMeeting() {
    if (confirm('Are you sure you want to leave the meeting?')) {
      // Stop screen share if active
      if (isScreenSharing) {
        stopScreenShare();
      }
      
      // Close all connections
      if (peer && !peer.destroyed) {
        peer.destroy();
      }
      
      // Stop local stream
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Clear localStorage
      localStorage.removeItem('meetingData');
      
      // Redirect to home
      window.location.href = 'index.html';
    }
  }
  
  // Toggle panel
  function togglePanel(panel) {
    // Close all panels first
    document.querySelectorAll('.side-panel').forEach(p => {
      if (p !== panel) {
        p.classList.remove('active');
      }
    });
    
    // Toggle current panel
    panel.classList.toggle('active');
  }
  
  // Show toast notification
  function showToast(message) {
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
  
  // Initialize the meeting
  initMeeting();
});