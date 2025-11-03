// Global variables
let peer;
let localStream;
let isHost = false;
let meetingData;
let participants = {};
let waitingRoom = {};
let mediaConnections = {};
let dataConnections = {};
let screenShareStream = null;
let isScreenSharing = false;
let meetingTimer;
let meetingSeconds = 0;

// DOM elements
const localVideo = document.getElementById('local-video');
const localName = document.getElementById('local-name');
const localIP = document.getElementById('local-ip');
const ipAddressElement = document.getElementById('ip-address');
const meetingIDElement = document.getElementById('meeting-id');
const meetingTimerElement = document.getElementById('meeting-timer');
const videoContainer = document.getElementById('video-container');
const muteBtn = document.getElementById('mute-btn');
const videoBtn = document.getElementById('video-btn');
const screenShareBtn = document.getElementById('screen-share-btn');
const chatBtn = document.getElementById('chat-btn');
const participantsBtn = document.getElementById('participants-btn');
const securityBtn = document.getElementById('security-btn');
const leaveBtn = document.getElementById('leave-btn');
const chatPanel = document.getElementById('chat-panel');
const participantsPanel = document.getElementById('participants-panel');
const securityPanel = document.getElementById('security-panel');
const waitingRoomElement = document.getElementById('waiting-room');
const leaveModal = document.getElementById('leave-modal');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');
const participantsList = document.getElementById('participants-list');
const waitingRoomList = document.getElementById('waiting-room-list');
const participantManagement = document.getElementById('participant-management');
const participantCount = document.getElementById('participant-count');

// Initialize the meeting room
document.addEventListener('DOMContentLoaded', async () => {
  // Get meeting data from localStorage
  const storedData = localStorage.getItem('meetingData');
  if (!storedData) {
    alert('No meeting data found. Redirecting to home page.');
    window.location.href = 'index.html';
    return;
  }

  meetingData = JSON.parse(storedData);
  isHost = meetingData.isHost;

  // Update UI with meeting info
  updateMeetingInfo();

  // Initialize PeerJS
  await initializePeerJS();

  // Get user media
  await getUserMedia();

  // Start meeting timer
  startMeetingTimer();

  // Set up event listeners
  setupEventListeners();

  // Show/hide host-only elements
  document.querySelectorAll('.host-only').forEach(el => {
    el.style.display = isHost ? 'flex' : 'none';
  });

  // If host, initialize the meeting room
  if (isHost) {
    initializeHostMeeting();
  } else {
    // If participant, connect to host
    connectToHost();
  }
});

// Update meeting info in the header
function updateMeetingInfo() {
  ipAddressElement.innerHTML = `<i class="fas fa-network-wired"></i> IP: ${meetingData.hostIP}`;
  meetingIDElement.innerHTML = `<i class="fas fa-id-badge"></i> Meeting ID: ${meetingData.meetingID}`;
  localName.textContent = meetingData.username;
  localIP.textContent = `IP: ${meetingData.hostIP}`;
}

// Initialize PeerJS
async function initializePeerJS() {
  try {
    // Check if PeerJS is loaded
    if (typeof Peer === 'undefined') {
      throw new Error('PeerJS library failed to load');
    }

    // Initialize PeerJS
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
    });

    peer.on('error', function(err) {
      console.error('PeerJS error:', err);
    });

    // Handle incoming connections
    peer.on('connection', handleDataConnection);
    peer.on('call', handleMediaConnection);

  } catch (error) {
    console.error('Failed to initialize PeerJS:', error);
    alert('Failed to initialize connection. Please refresh the page.');
  }
}

// Get user media
async function getUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (error) {
    console.error('Error getting user media:', error);
    alert('Failed to access camera and microphone. Please check permissions.');
  }
}

// Start meeting timer
function startMeetingTimer() {
  meetingTimer = setInterval(() => {
    meetingSeconds++;
    const hours = Math.floor(meetingSeconds / 3600);
    const minutes = Math.floor((meetingSeconds % 3600) / 60);
    const seconds = meetingSeconds % 60;
    meetingTimerElement.textContent = 
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);
}

// Setup event listeners
function setupEventListeners() {
  // Control buttons
  muteBtn.addEventListener('click', toggleMute);
  videoBtn.addEventListener('click', toggleVideo);
  screenShareBtn.addEventListener('click', toggleScreenShare);
  chatBtn.addEventListener('click', toggleChat);
  participantsBtn.addEventListener('click', toggleParticipants);
  securityBtn.addEventListener('click', toggleSecurity);
  leaveBtn.addEventListener('click', showLeaveModal);

  // Panel close buttons
  document.getElementById('close-chat').addEventListener('click', () => {
    chatPanel.classList.add('hidden');
  });
  document.getElementById('close-participants').addEventListener('click', () => {
    participantsPanel.classList.add('hidden');
  });
  document.getElementById('close-security').addEventListener('click', () => {
    securityPanel.classList.add('hidden');
  });

  // Leave modal buttons
  document.getElementById('cancel-leave').addEventListener('click', hideLeaveModal);
  document.getElementById('confirm-leave').addEventListener('click', leaveMeeting);

  // Chat functionality
  sendMessageBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    }
  });
}

// Initialize host meeting
function initializeHostMeeting() {
  console.log('Host meeting initialized');
  // Host doesn't need to wait, they are automatically in the meeting
}

// Connect to host (for participants)
function connectToHost() {
  // Show waiting room for participants
  waitingRoomElement.style.display = 'flex';

  // Connect to host via data connection
  const conn = peer.connect(meetingData.hostPeerId, {
    reliable: true
  });

  conn.on('open', function() {
    console.log('Connected to host:', meetingData.hostPeerId);
    dataConnections[meetingData.hostPeerId] = conn;

    // Send join request to host
    conn.send({
      type: 'join-request',
      participantId: peer.id,
      username: meetingData.username,
      ip: meetingData.hostIP
    });
  });

  conn.on('data', function(data) {
    handleDataFromHost(data);
  });

  conn.on('error', function(err) {
    console.error('Connection error:', err);
    alert('Failed to connect to host. Please try again.');
    window.location.href = 'index.html';
  });
}

// Handle data connection from participants (host only)
function handleDataConnection(conn) {
  if (!isHost) return;

  console.log('Incoming connection from:', conn.peer);
  dataConnections[conn.peer] = conn;

  conn.on('open', function() {
    console.log('Data connection established with:', conn.peer);
  });

  conn.on('data', function(data) {
    handleDataFromParticipant(conn.peer, data);
  });

  conn.on('close', function() {
    console.log('Data connection closed with:', conn.peer);
    handleParticipantLeft(conn.peer);
  });
}

// Handle media connection from participants (host only)
function handleMediaConnection(call) {
  if (!isHost) return;

  console.log('Incoming call from:', call.peer);
  mediaConnections[call.peer] = call;

  call.answer(localStream);

  call.on('stream', function(remoteStream) {
    console.log('Received stream from:', call.peer);
    addVideoElement(call.peer, remoteStream);
  });

  call.on('close', function() {
    console.log('Media connection closed with:', call.peer);
    removeVideoElement(call.peer);
  });
}

// Handle data from host (participant only)
function handleDataFromHost(data) {
  switch (data.type) {
    case 'join-approved':
      // Hide waiting room and join the meeting
      waitingRoomElement.style.display = 'none';
      
      // Connect media to host
      const call = peer.call(meetingData.hostPeerId, localStream);
      mediaConnections[meetingData.hostPeerId] = call;
      
      call.on('stream', function(remoteStream) {
        addVideoElement(meetingData.hostPeerId, remoteStream, data.username);
      });
      
      // Update participant list
      updateParticipantsList();
      break;
      
    case 'join-denied':
      alert('Your request to join the meeting was denied.');
      window.location.href = 'index.html';
      break;
      
    case 'mute':
      // Host is muting this participant
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = false;
        });
        updateMuteButton(true);
      }
      break;
      
    case 'unmute':
      // Host is unmuting this participant
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
        updateMuteButton(false);
      }
      break;
      
    case 'kick':
      // Host is kicking this participant
      alert('You have been removed from the meeting by the host.');
      window.location.href = 'index.html';
      break;
      
    case 'chat-message':
      // Display chat message from host
      addChatMessage(data.username, data.message, false);
      break;
      
    case 'participants-update':
      // Update participants list
      participants = data.participants;
      updateParticipantsList();
      break;
  }
}

// Handle data from participants (host only)
function handleDataFromParticipant(participantId, data) {
  switch (data.type) {
    case 'join-request':
      // Add participant to waiting room
      waitingRoom[participantId] = {
        id: participantId,
        username: data.username,
        ip: data.ip
      };
      updateWaitingRoomList();
      break;
      
    case 'chat-message':
      // Broadcast chat message to all participants
      broadcastChatMessage(data.username, data.message);
      addChatMessage(data.username, data.message, false);
      break;
      
    case 'screen-share-start':
      // Handle screen share start
      broadcastScreenShareStart(participantId);
      break;
      
    case 'screen-share-stop':
      // Handle screen share stop
      broadcastScreenShareStop(participantId);
      break;
  }
}

// Handle participant leaving (host only)
function handleParticipantLeft(participantId) {
  if (participants[participantId]) {
    delete participants[participantId];
    updateParticipantsList();
    broadcastParticipantsUpdate();
  }
  
  if (waitingRoom[participantId]) {
    delete waitingRoom[participantId];
    updateWaitingRoomList();
  }
  
  removeVideoElement(participantId);
}

// Toggle mute
function toggleMute() {
  if (!localStream) return;
  
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    const isEnabled = audioTracks[0].enabled;
    audioTracks[0].enabled = !isEnabled;
    updateMuteButton(!isEnabled);
    
    // Notify host if participant
    if (!isHost && dataConnections[meetingData.hostPeerId]) {
      dataConnections[meetingData.hostPeerId].send({
        type: 'audio-state-changed',
        enabled: !isEnabled
      });
    }
  }
}

// Update mute button
function updateMuteButton(isMuted) {
  if (isMuted) {
    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    muteBtn.classList.add('muted');
    document.getElementById('local-mute-indicator').classList.add('muted');
  } else {
    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    muteBtn.classList.remove('muted');
    document.getElementById('local-mute-indicator').classList.remove('muted');
  }
}

// Toggle video
function toggleVideo() {
  if (!localStream) return;
  
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length > 0) {
    const isEnabled = videoTracks[0].enabled;
    videoTracks[0].enabled = !isEnabled;
    updateVideoButton(!isEnabled);
    
    // Notify host if participant
    if (!isHost && dataConnections[meetingData.hostPeerId]) {
      dataConnections[meetingData.hostPeerId].send({
        type: 'video-state-changed',
        enabled: !isEnabled
      });
    }
  }
}

// Update video button
function updateVideoButton(isEnabled) {
  if (!isEnabled) {
    videoBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
    videoBtn.classList.add('video-off');
    document.getElementById('local-video-indicator').classList.add('video-off');
  } else {
    videoBtn.innerHTML = '<i class="fas fa-video"></i>';
    videoBtn.classList.remove('video-off');
    document.getElementById('local-video-indicator').classList.remove('video-off');
  }
}

// Toggle screen share
async function toggleScreenShare() {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
}

// Start screen share
async function startScreenShare() {
  try {
    screenShareStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    
    // Replace local video with screen share
    localVideo.srcObject = screenShareStream;
    
    // Update button
    screenShareBtn.innerHTML = '<i class="fas fa-stop"></i>';
    screenShareBtn.classList.add('active');
    isScreenSharing = true;
    
    // Notify others
    if (isHost) {
      broadcastScreenShareStart(peer.id);
    } else if (dataConnections[meetingData.hostPeerId]) {
      dataConnections[meetingData.hostPeerId].send({
        type: 'screen-share-start'
      });
    }
    
    // Handle end of screen share
    screenShareStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopScreenShare();
    });
    
  } catch (error) {
    console.error('Error starting screen share:', error);
    alert('Failed to start screen share. Please check permissions.');
  }
}

// Stop screen share
function stopScreenShare() {
  if (screenShareStream) {
    screenShareStream.getTracks().forEach(track => track.stop());
    screenShareStream = null;
  }
  
  // Restore local video
  localVideo.srcObject = localStream;
  
  // Update button
  screenShareBtn.innerHTML = '<i class="fas fa-desktop"></i>';
  screenShareBtn.classList.remove('active');
  isScreenSharing = false;
  
  // Notify others
  if (isHost) {
    broadcastScreenShareStop(peer.id);
  } else if (dataConnections[meetingData.hostPeerId]) {
    dataConnections[meetingData.hostPeerId].send({
      type: 'screen-share-stop'
    });
  }
}

// Toggle chat panel
function toggleChat() {
  chatPanel.classList.toggle('hidden');
  participantsPanel.classList.add('hidden');
  securityPanel.classList.add('hidden');
}

// Toggle participants panel
function toggleParticipants() {
  participantsPanel.classList.toggle('hidden');
  chatPanel.classList.add('hidden');
  securityPanel.classList.add('hidden');
  updateParticipantsList();
}

// Toggle security panel (host only)
function toggleSecurity() {
  if (!isHost) return;
  
  securityPanel.classList.toggle('hidden');
  chatPanel.classList.add('hidden');
  participantsPanel.classList.add('hidden');
  updateWaitingRoomList();
  updateParticipantManagement();
}

// Send chat message
function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  
  // Add message to local chat
  addChatMessage(meetingData.username, message, true);
  
  // Send message to others
  if (isHost) {
    broadcastChatMessage(meetingData.username, message);
  } else if (dataConnections[meetingData.hostPeerId]) {
    dataConnections[meetingData.hostPeerId].send({
      type: 'chat-message',
      username: meetingData.username,
      message: message
    });
  }
  
  // Clear input
  chatInput.value = '';
}

// Add chat message to UI
function addChatMessage(username, message, isOwn) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  if (isOwn) messageElement.classList.add('own');
  
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  messageElement.innerHTML = `
    <div class="message-header">${username} · ${time}</div>
    <div class="message-content">${message}</div>
  `;
  
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Broadcast chat message to all participants (host only)
function broadcastChatMessage(username, message) {
  if (!isHost) return;
  
  Object.values(dataConnections).forEach(conn => {
    conn.send({
      type: 'chat-message',
      username: username,
      message: message
    });
  });
}

// Update participants list
function updateParticipantsList() {
  participantsList.innerHTML = '';
  
  // Add local participant
  const localParticipant = document.createElement('div');
  localParticipant.classList.add('participant-item');
  localParticipant.innerHTML = `
    <div class="participant-info">
      <div class="participant-avatar">${meetingData.username.charAt(0).toUpperCase()}</div>
      <div class="participant-details">
        <div class="participant-name">${meetingData.username} (You)</div>
        <div class="participant-status">IP: ${meetingData.hostIP}</div>
      </div>
    </div>
    <div class="participant-controls">
      <i class="fas fa-microphone" id="local-mute-indicator"></i>
      <i class="fas fa-video" id="local-video-indicator"></i>
    </div>
  `;
  participantsList.appendChild(localParticipant);
  
  // Add other participants
  Object.values(participants).forEach(participant => {
    const participantElement = document.createElement('div');
    participantElement.classList.add('participant-item');
    participantElement.innerHTML = `
      <div class="participant-info">
        <div class="participant-avatar">${participant.username.charAt(0).toUpperCase()}</div>
        <div class="participant-details">
          <div class="participant-name">${participant.username}</div>
          <div class="participant-status">IP: ${isHost ? participant.ip : 'Hidden'}</div>
        </div>
      </div>
      <div class="participant-controls">
        <i class="fas fa-microphone ${participant.muted ? 'muted' : ''}"></i>
        <i class="fas fa-video ${participant.videoOff ? 'video-off' : ''}"></i>
      </div>
    `;
    participantsList.appendChild(participantElement);
  });
  
  // Update participant count
  const count = 1 + Object.keys(participants).length;
  participantCount.textContent = count;
}

// Update waiting room list (host only)
function updateWaitingRoomList() {
  if (!isHost) return;
  
  waitingRoomList.innerHTML = '';
  
  if (Object.keys(waitingRoom).length === 0) {
    waitingRoomList.innerHTML = '<p>No participants in waiting room</p>';
    return;
  }
  
  Object.values(waitingRoom).forEach(participant => {
    const waitingElement = document.createElement('div');
    waitingElement.classList.add('waiting-participant');
    waitingElement.innerHTML = `
      <div>${participant.username} (IP: ${participant.ip})</div>
      <div class="action-buttons">
        <button class="btn-approve" onclick="approveParticipant('${participant.id}')">Admit</button>
        <button class="btn-deny" onclick="denyParticipant('${participant.id}')">Deny</button>
      </div>
    `;
    waitingRoomList.appendChild(waitingElement);
  });
}

// Update participant management (host only)
function updateParticipantManagement() {
  if (!isHost) return;
  
  participantManagement.innerHTML = '';
  
  if (Object.keys(participants).length === 0) {
    participantManagement.innerHTML = '<p>No participants to manage</p>';
    return;
  }
  
  Object.values(participants).forEach(participant => {
    const managementElement = document.createElement('div');
    managementElement.classList.add('management-item');
    managementElement.innerHTML = `
      <div>${participant.username} (IP: ${participant.ip})</div>
      <div class="action-buttons">
        <button class="btn-mute" onclick="toggleParticipantMute('${participant.id}')">${participant.muted ? 'Unmute' : 'Mute'}</button>
        <button class="btn-kick" onclick="kickParticipant('${participant.id}')">Remove</button>
      </div>
    `;
    participantManagement.appendChild(managementElement);
  });
}

// Approve participant (host only)
function approveParticipant(participantId) {
  if (!isHost) return;
  
  const participant = waitingRoom[participantId];
  if (!participant) return;
  
  // Add to participants list
  participants[participantId] = participant;
  
  // Remove from waiting room
  delete waitingRoom[participantId];
  
  // Update UI
  updateWaitingRoomList();
  updateParticipantsList();
  updateParticipantManagement();
  broadcastParticipantsUpdate();
  
  // Notify participant
  if (dataConnections[participantId]) {
    dataConnections[participantId].send({
      type: 'join-approved',
      username: meetingData.username
    });
    
    // Call the participant to establish media connection
    const call = peer.call(participantId, localStream);
    mediaConnections[participantId] = call;
    
    call.on('stream', function(remoteStream) {
      addVideoElement(participantId, remoteStream, participant.username);
    });
    
    call.on('close', function() {
      removeVideoElement(participantId);
    });
  }
}

// Deny participant (host only)
function denyParticipant(participantId) {
  if (!isHost) return;
  
  // Remove from waiting room
  delete waitingRoom[participantId];
  
  // Update UI
  updateWaitingRoomList();
  
  // Notify participant
  if (dataConnections[participantId]) {
    dataConnections[participantId].send({
      type: 'join-denied'
    });
    
    // Close connection
    dataConnections[participantId].close();
    delete dataConnections[participantId];
  }
}

// Toggle participant mute (host only)
function toggleParticipantMute(participantId) {
  if (!isHost) return;
  
  const participant = participants[participantId];
  if (!participant) return;
  
  // Toggle mute state
  participant.muted = !participant.muted;
  
  // Update UI
  updateParticipantsList();
  updateParticipantManagement();
  
  // Notify participant
  if (dataConnections[participantId]) {
    dataConnections[participantId].send({
      type: participant.muted ? 'mute' : 'unmute'
    });
  }
}

// Kick participant (host only)
function kickParticipant(participantId) {
  if (!isHost) return;
  
  // Remove from participants
  delete participants[participantId];
  
  // Update UI
  updateParticipantsList();
  updateParticipantManagement();
  broadcastParticipantsUpdate();
  
  // Notify participant
  if (dataConnections[participantId]) {
    dataConnections[participantId].send({
      type: 'kick'
    });
    
    // Close connections
    dataConnections[participantId].close();
    delete dataConnections[participantId];
  }
  
  if (mediaConnections[participantId]) {
    mediaConnections[participantId].close();
    delete mediaConnections[participantId];
  }
  
  // Remove video element
  removeVideoElement(participantId);
}

// Broadcast participants update (host only)
function broadcastParticipantsUpdate() {
  if (!isHost) return;
  
  Object.values(dataConnections).forEach(conn => {
    conn.send({
      type: 'participants-update',
      participants: participants
    });
  });
}

// Broadcast screen share start (host only)
function broadcastScreenShareStart(participantId) {
  if (!isHost) return;
  
  Object.values(dataConnections).forEach(conn => {
    if (conn.peer !== participantId) {
      conn.send({
        type: 'screen-share-start',
        participantId: participantId
      });
    }
  });
}

// Broadcast screen share stop (host only)
function broadcastScreenShareStop(participantId) {
  if (!isHost) return;
  
  Object.values(dataConnections).forEach(conn => {
    if (conn.peer !== participantId) {
      conn.send({
        type: 'screen-share-stop',
        participantId: participantId
      });
    }
  });
}

// Add video element to the grid
function addVideoElement(participantId, stream, username) {
  // Check if video element already exists
  let videoElement = document.getElementById(`video-${participantId}`);
  
  if (videoElement) {
    // Update existing video element
    const video = videoElement.querySelector('video');
    video.srcObject = stream;
    return;
  }
  
  // Create new video element
  const videoContainer = document.createElement('div');
  videoContainer.classList.add('video-placeholder');
  videoContainer.id = `video-${participantId}`;
  
  videoContainer.innerHTML = `
    <div class="video-wrapper">
      <video autoplay playsinline></video>
      <div class="video-info">
        <span>${username || participantId}</span>
        <span class="ip-address">${isHost && participants[participantId] ? 'IP: ' + participants[participantId].ip : ''}</span>
      </div>
      <div class="video-controls">
        <i class="fas fa-microphone"></i>
        <i class="fas fa-video"></i>
      </div>
    </div>
  `;
  
  // Add to video container
  videoContainer.querySelector('video').srcObject = stream;
  document.getElementById('video-container').appendChild(videoContainer);
}

// Remove video element from the grid
function removeVideoElement(participantId) {
  const videoElement = document.getElementById(`video-${participantId}`);
  if (videoElement) {
    videoElement.remove();
  }
}

// Show leave modal
function showLeaveModal() {
  leaveModal.style.display = 'flex';
}

// Hide leave modal
function hideLeaveModal() {
  leaveModal.style.display = 'none';
}

// Leave meeting
function leaveMeeting() {
  // Close all connections
  Object.values(dataConnections).forEach(conn => conn.close());
  Object.values(mediaConnections).forEach(call => call.close());
  
  // Destroy peer connection
  if (peer && !peer.destroyed) {
    peer.destroy();
  }
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  // Stop screen share if active
  if (isScreenSharing) {
    stopScreenShare();
  }
  
  // Clear meeting timer
  clearInterval(meetingTimer);
  
  // Clear localStorage
  localStorage.removeItem('meetingData');
  
  // Redirect to home page
  window.location.href = 'index.html';
}