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
  
  // DOM elements
  const ipAddressEl = document.getElementById('ip-address');
  const meetingIdEl = document.getElementById('meeting-id');
  const videoGrid = document.getElementById('video-grid');
  const hostVideo = document.getElementById('host-video');
  const participantsPanel = document.getElementById('participants-panel');
  const chatPanel = document.getElementById('chat-panel');
  const securityPanel = document.getElementById('security-panel');
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

      // Update icons to show as Active (On) immediately for the host
      updateStatusIcon('host', 'audio', true);
      updateStatusIcon('host', 'video', true);

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

    // Chat Button Logic
    document.getElementById('chat-btn').addEventListener('click', () => {
        togglePanel(chatPanel);
        // Focus input when opening
        setTimeout(() => chatInput.focus(), 100);
    });
    
    document.getElementById('security-btn').addEventListener('click', () => {
      if (isHost) {
        togglePanel(securityPanel);
      } else {
        showToast('Security options are only available to the host');
      }
    });
    
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

      // 1. Display locally
      addMessageToChat(messageData, true);

      // 2. Broadcast
      if (isHost) {
          // If Host, broadcast to everyone connected
          broadcastMessage(messageData);
      } else {
          // If Client, send to Host (Host will broadcast to others)
          // Find connection to host and send
          // We don't have a direct reference to the single host connection easily stored in a global
          // but we can find it in the peer.connections
          // Or easier: we stored it in 'participants' usually, but participants list is peers.
          // Let's iterate peer.connections to find the one to host.
          // In this architecture, client initiates connection to hostPeerId.
          
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
      
      let html = '';
      if (!isSelf) {
          html += `<div class="message-sender">${data.sender}</div>`;
      }
      
      html += `
          <div class="message-bubble">${data.message}</div>
          <div class="message-time">${data.time}</div>
      `;
      
      wrapper.innerHTML = html;
      chatMessages.appendChild(wrapper);
      
      // Scroll to bottom
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // If panel is closed and new message arrives, show notification dot (Optional enhancement)
      if(!chatPanel.classList.contains('active') && !isSelf) {
          const chatBtn = document.getElementById('chat-btn');
          chatBtn.classList.add('active'); // Turn blue to indicate activity
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

  // --- END CHAT FUNCTIONS ---
  
  // Update UI based on host status
  function updateHostUI() {
    if (!isHost) {
      // Hide security button for participants
      document.getElementById('security-btn').style.display = 'none';
      
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
      } else if (data.type === 'chat') {
          // Host received chat from a participant
          // 1. Show locally
          addMessageToChat(data, false);
          // 2. Broadcast to everyone else
          broadcastMessage(data, conn.peer);
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
          updateStatusIcon('host', 'audio', false); // Update local icon too
          showToast('You have been muted by the host');
        }
        break;
      case 'kicked':
        showToast('You have been removed from the meeting');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 2000);
        break;
      case 'chat':
        addMessageToChat(data, false);
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
      
      // Mute button
      const muteBtn = document.createElement('button');
      muteBtn.className = 'participant-action-btn';
      muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
      muteBtn.title = 'Mute';
      muteBtn.addEventListener('click', () => muteParticipant(participant.id));
      
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
  
  // Mute participant (host only)
  function muteParticipant(participantId) {
    if (!isHost) return;
    
    const participant = participants[participantId];
    if (!participant) return;
    
    // Send mute command
    participant.conn.send({
      type: 'mute'
    });
    
    // Update local state
    participant.muted = true;
    
    showToast(`${participant.username} has been muted`);
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
      
      // Check initial state of the incoming stream
      const isAudioEnabled = stream.getAudioTracks().length > 0 && stream.getAudioTracks()[0].enabled;
      const isVideoEnabled = stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;

      // Determine classes based on state
      const micClass = isAudioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash muted-icon';
      const videoClass = isVideoEnabled ? 'fas fa-video' : 'fas fa-video-slash muted-icon';

      const participantStatus = document.createElement('div');
      participantStatus.className = 'participant-status';
      participantStatus.innerHTML = `
        <i class="${micClass}"></i>
        <i class="${videoClass}"></i>
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
      // Update visual icon on video feed
      updateStatusIcon('host', 'audio', enabled);
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
      updateVideoButton(enabled);
      // Update visual icon on video feed
      updateStatusIcon('host', 'video', enabled);
    }
  }
  
  // Update video button
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

  // Update Status Icon Helper
  function updateStatusIcon(participantId, type, isEnabled) {
    const containerId = participantId === 'host' ? 'host-video-container' : `video-${participantId}`;
    const container = document.getElementById(containerId);
    
    if (!container) return;
  
    const statusContainer = container.querySelector('.participant-status');
    if (!statusContainer) return;
  
    // Select the specific icon (first is mic, second is video)
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
  
  // Toggle screen share
  function toggleScreenShare() {
    // This is a placeholder for screen sharing functionality
    showToast('Screen sharing is not yet implemented');
  }
  
  // Leave meeting
  function leaveMeeting() {
    if (confirm('Are you sure you want to leave the meeting?')) {
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