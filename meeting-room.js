// Global variables
let peer;
let localStream;
let isHost = false;
let meetingData;
let participants = {};
let connections = {};
let meetingTimer;
let meetingSeconds = 0;

// DOM elements
const videoGrid = document.getElementById('video-grid');
const ipAddressElement = document.getElementById('ip-address');
const meetingIdElement = document.getElementById('meeting-id');
const meetingTimerElement = document.getElementById('meeting-timer');
const micBtn = document.getElementById('mic-btn');
const cameraBtn = document.getElementById('camera-btn');
const screenShareBtn = document.getElementById('screen-share-btn');
const chatBtn = document.getElementById('chat-btn');
const participantsBtn = document.getElementById('participants-btn');
const securityBtn = document.getElementById('security-btn');
const leaveBtn = document.getElementById('leave-btn');
const chatPanel = document.getElementById('chat-panel');
const participantsPanel = document.getElementById('participants-panel');
const securityPanel = document.getElementById('security-panel');
const approvalModal = document.getElementById('approval-modal');
const approveBtn = document.getElementById('approve-btn');
const denyBtn = document.getElementById('deny-btn');
const toast = document.getElementById('toast');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message-btn');
const participantsList = document.getElementById('participants-list');
const participantsManagement = document.getElementById('participants-management');

// Initialize the meeting room
async function initMeetingRoom() {
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

  // Set up UI based on host status
  if (isHost) {
    document.body.classList.add('is-host');
  }

  // Display meeting info
  ipAddressElement.textContent = meetingData.hostIP;
  meetingIdElement.textContent = meetingData.meetingID;

  // Initialize PeerJS
  await initializePeerJS();

  // Get user media
  await getUserMedia();

  // Set up event listeners
  setupEventListeners();

  // Start meeting timer
  startMeetingTimer();

  // If host, set up to receive connection requests
  if (isHost) {
    setupHostListeners();
  } else {
    // If participant, connect to host
    connectToHost();
  }
}

// Initialize PeerJS
async function initializePeerJS() {
  try {
    if (typeof Peer === 'undefined') {
      throw new Error('PeerJS library failed to load');
    }

    // Initialize PeerJS with the stored peer ID
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
      showToast('Connection error: ' + err.message);
    });

    // Handle incoming calls (for video streams)
    peer.on('call', function(call) {
      call.answer(localStream);
      call.on('stream', function(remoteStream) {
        const participantId = call.peer;
        if (participants[participantId]) {
          addVideoStream(participantId, remoteStream, participants[participantId].name);
        }
      });
    });

  } catch (error) {
    console.error('Failed to initialize PeerJS:', error);
    showToast('Failed to initialize connection');
  }
}

// Get user media (camera and microphone)
async function getUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    // Display local video
    const localVideo = document.getElementById('host-video');
    localVideo.srcObject = localStream;

    // Display host IP if host
    if (isHost) {
      document.getElementById('host-ip-display').textContent = meetingData.hostIP;
    }

  } catch (error) {
    console.error('Error accessing media devices:', error);
    showToast('Could not access camera or microphone');
  }
}

// Set up event listeners
function setupEventListeners() {
  // Control buttons
  micBtn.addEventListener('click', toggleMic);
  cameraBtn.addEventListener('click', toggleCamera);
  screenShareBtn.addEventListener('click', toggleScreenShare);
  leaveBtn.addEventListener('click', leaveMeeting);

  // Panel buttons
  chatBtn.addEventListener('click', () => togglePanel(chatPanel));
  participantsBtn.addEventListener('click', () => {
    updateParticipantsList();
    togglePanel(participantsPanel);
  });
  securityBtn.addEventListener('click', () => {
    updateParticipantsManagement();
    togglePanel(securityPanel);
  });

  // Close panel buttons
  document.getElementById('close-chat-btn').addEventListener('click', () => {
    chatPanel.classList.remove('active');
  });
  document.getElementById('close-participants-btn').addEventListener('click', () => {
    participantsPanel.classList.remove('active');
  });
  document.getElementById('close-security-btn').addEventListener('click', () => {
    securityPanel.classList.remove('active');
  });

  // Chat functionality
  sendMessageBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  // Approval modal buttons
  approveBtn.addEventListener('click', approveParticipant);
  denyBtn.addEventListener('click', denyParticipant);

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (peer && !peer.destroyed) {
      peer.destroy();
    }
  });
}

// Set up host-specific listeners
function setupHostListeners() {
  peer.on('connection', function(conn) {
    console.log('Incoming connection from:', conn.peer);
    
    conn.on('data', function(data) {
      handleParticipantData(conn.peer, data);
    });

    // Store the connection
    connections[conn.peer] = conn;
  });
}

// Connect to host (for participants)
function connectToHost() {
  try {
    const conn = peer.connect(meetingData.hostPeerId, {
      reliable: true
    });

    conn.on('open', function() {
      console.log('Connected to host:', meetingData.hostPeerId);
      
      // Send join request with participant info
      conn.send({
        type: 'join-request',
        participantId: peer.id,
        username: meetingData.username,
        ip: meetingData.hostIP
      });
    });

    conn.on('data', function(data) {
      handleHostData(data);
    });

    // Store the connection
    connections[meetingData.hostPeerId] = conn;
  } catch (error) {
    console.error('Failed to connect to host:', error);
    showToast('Failed to connect to host');
  }
}

// Handle data from participants (for host)
function handleParticipantData(participantId, data) {
  switch (data.type) {
    case 'join-request':
      // Show approval modal
      showApprovalModal(participantId, data.username, data.ip);
      break;
    case 'chat-message':
      // Display chat message
      addChatMessage(data.username, data.message, false);
      break;
  }
}

// Handle data from host (for participants)
function handleHostData(data) {
  switch (data.type) {
    case 'join-approved':
      // Host approved the join request
      showToast('You have joined the meeting');
      // Call the host to establish video connection
      callHost();
      break;
    case 'join-denied':
      // Host denied the join request
      showToast('Your request to join was denied');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      break;
    case 'chat-message':
      // Display chat message from host
      addChatMessage(data.username, data.message, true);
      break;
    case 'mute':
      // Host is muting this participant
      if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = false);
        micBtn.classList.remove('active');
        showToast('You have been muted by the host');
      }
      break;
    case 'unmute':
      // Host is unmuting this participant
      if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = true);
        micBtn.classList.add('active');
        showToast('You have been unmuted by the host');
      }
      break;
    case 'kick':
      // Host is kicking this participant
      showToast('You have been removed from the meeting');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      break;
  }
}

// Call the host to establish video connection (for participants)
function callHost() {
  const call = peer.call(meetingData.hostPeerId, localStream);
  call.on('stream', function(remoteStream) {
    // Add host video to grid
    addVideoStream(meetingData.hostPeerId, remoteStream, 'Host');
  });
}

// Show approval modal (for host)
function showApprovalModal(participantId, username, ip) {
  document.getElementById('requester-name').textContent = username;
  document.getElementById('requester-ip').textContent = ip;
  
  // Store participant info for later use
  approvalModal.dataset.participantId = participantId;
  approvalModal.dataset.username = username;
  approvalModal.dataset.ip = ip;
  
  approvalModal.classList.add('active');
}

// Approve participant (for host)
function approveParticipant() {
  const participantId = approvalModal.dataset.participantId;
  const username = approvalModal.dataset.username;
  const ip = approvalModal.dataset.ip;
  
  // Add participant to list
  participants[participantId] = {
    name: username,
    ip: ip,
    muted: false,
    videoEnabled: true
  };
  
  // Send approval to participant
  if (connections[participantId]) {
    connections[participantId].send({
      type: 'join-approved'
    });
  }
  
  // Call the participant to get their video stream
  const call = peer.call(participantId, localStream);
  call.on('stream', function(remoteStream) {
    addVideoStream(participantId, remoteStream, username);
  });
  
  // Update UI
  updateParticipantsList();
  showToast(`${username} has joined the meeting`);
  
  // Close modal
  approvalModal.classList.remove('active');
}

// Deny participant (for host)
function denyParticipant() {
  const participantId = approvalModal.dataset.participantId;
  const username = approvalModal.dataset.username;
  
  // Send denial to participant
  if (connections[participantId]) {
    connections[participantId].send({
      type: 'join-denied'
    });
  }
  
  // Close connection
  if (connections[participantId]) {
    connections[participantId].close();
    delete connections[participantId];
  }
  
  // Close modal
  approvalModal.classList.remove('active');
}

// Add video stream to grid
function addVideoStream(participantId, stream, name) {
  // Check if video element already exists
  let videoWrapper = document.getElementById(`video-${participantId}`);
  
  if (!videoWrapper) {
    // Create new video wrapper
    videoWrapper = document.createElement('div');
    videoWrapper.id = `video-${participantId}`;
    videoWrapper.className = 'video-wrapper';
    
    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;
    
    // Create video info
    const videoInfo = document.createElement('div');
    videoInfo.className = 'video-info';
    
    const participantName = document.createElement('span');
    participantName.className = 'participant-name';
    participantName.textContent = name;
    
    const participantIp = document.createElement('span');
    participantIp.className = 'participant-ip';
    participantIp.textContent = participants[participantId] ? participants[participantId].ip : '';
    
    videoInfo.appendChild(participantName);
    if (isHost && participants[participantId]) {
      videoInfo.appendChild(participantIp);
    }
    
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(videoInfo);
    
    videoGrid.appendChild(videoWrapper);
  }
}

// Toggle microphone
function toggleMic() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      // Only allow host to toggle their own mic
      if (isHost) {
        audioTrack.enabled = !audioTrack.enabled;
        micBtn.classList.toggle('active');
      } else {
        showToast('Only the host can control microphone');
      }
    }
  }
}

// Toggle camera
function toggleCamera() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      cameraBtn.classList.toggle('active');
    }
  }
}

// Toggle screen sharing
async function toggleScreenShare() {
  try {
    if (!screenShareBtn.classList.contains('active')) {
      // Start screen share
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      // Replace video track with screen share track
      const videoTrack = screenStream.getVideoTracks()[0];
      const sender = localStream.getVideoTracks()[0];
      
      // Update local video
      const localVideo = document.getElementById('host-video');
      localVideo.srcObject = screenStream;
      
      // Notify all participants about screen share
      if (isHost) {
        Object.keys(connections).forEach(participantId => {
          if (connections[participantId]) {
            connections[participantId].send({
              type: 'screen-share-started',
              senderId: peer.id
            });
          }
        });
      }
      
      screenShareBtn.classList.add('active');
      
      // Handle screen share end
      videoTrack.onended = () => {
        stopScreenShare();
      };
    } else {
      // Stop screen share
      stopScreenShare();
    }
  } catch (error) {
    console.error('Error sharing screen:', error);
    showToast('Failed to share screen');
  }
}

// Stop screen sharing
function stopScreenShare() {
  // Restore camera video
  navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  }).then(stream => {
    const localVideo = document.getElementById('host-video');
    localVideo.srcObject = stream;
    
    // Replace the stream
    localStream = stream;
    
    // Notify all participants
    if (isHost) {
      Object.keys(connections).forEach(participantId => {
        if (connections[participantId]) {
          connections[participantId].send({
            type: 'screen-share-stopped',
            senderId: peer.id
          });
        }
      });
    }
    
    screenShareBtn.classList.remove('active');
  }).catch(error => {
    console.error('Error restoring camera:', error);
  });
}

// Leave meeting
function leaveMeeting() {
  if (confirm('Are you sure you want to leave the meeting?')) {
    // Notify other participants if host
    if (isHost) {
      Object.keys(connections).forEach(participantId => {
        if (connections[participantId]) {
          connections[participantId].send({
            type: 'meeting-ended'
          });
        }
      });
    }
    
    // Clean up
    if (peer && !peer.destroyed) {
      peer.destroy();
    }
    
    // Redirect to home
    window.location.href = 'index.html';
  }
}

// Toggle panel visibility
function togglePanel(panel) {
  // Close all panels first
  chatPanel.classList.remove('active');
  participantsPanel.classList.remove('active');
  securityPanel.classList.remove('active');
  
  // Toggle the requested panel
  panel.classList.toggle('active');
}

// Send chat message
function sendMessage() {
  const message = chatInput.value.trim();
  if (message) {
    // Add message to local chat
    addChatMessage(meetingData.username, message, isHost);
    
    // Send message to all participants
    if (isHost) {
      Object.keys(connections).forEach(participantId => {
        if (connections[participantId]) {
          connections[participantId].send({
            type: 'chat-message',
            username: meetingData.username,
            message: message
          });
        }
      });
    } else {
      // Send to host
      if (connections[meetingData.hostPeerId]) {
        connections[meetingData.hostPeerId].send({
          type: 'chat-message',
          username: meetingData.username,
          message: message
        });
      }
    }
    
    // Clear input
    chatInput.value = '';
  }
}

// Add chat message to UI
function addChatMessage(username, message, isHost) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isHost ? 'message-host' : ''}`;
  
  const senderElement = document.createElement('div');
  senderElement.className = 'message-sender';
  senderElement.textContent = username;
  
  const textElement = document.createElement('div');
  textElement.className = 'message-text';
  textElement.textContent = message;
  
  messageElement.appendChild(senderElement);
  messageElement.appendChild(textElement);
  
  chatMessages.appendChild(messageElement);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Update participants list
function updateParticipantsList() {
  participantsList.innerHTML = '';
  
  // Add host
  const hostItem = createParticipantItem(
    peer.id,
    meetingData.username,
    meetingData.hostIP,
    true
  );
  participantsList.appendChild(hostItem);
  
  // Add other participants
  Object.keys(participants).forEach(participantId => {
    const participant = participants[participantId];
    const participantItem = createParticipantItem(
      participantId,
      participant.name,
      participant.ip,
      false
    );
    participantsList.appendChild(participantItem);
  });
}

// Create participant item for list
function createParticipantItem(id, name, ip, isHost) {
  const item = document.createElement('div');
  item.className = 'participant-item';
  
  const avatar = document.createElement('div');
  avatar.className = 'participant-avatar';
  avatar.textContent = name.charAt(0).toUpperCase();
  
  const details = document.createElement('div');
  details.className = 'participant-details';
  
  const nameElement = document.createElement('div');
  nameElement.className = 'participant-name';
  nameElement.textContent = name + (isHost ? ' (Host)' : '');
  
  const statusElement = document.createElement('div');
  statusElement.className = 'participant-status';
  statusElement.textContent = 'Connected';
  
  details.appendChild(nameElement);
  details.appendChild(statusElement);
  
  item.appendChild(avatar);
  item.appendChild(details);
  
  // Add IP for host
  if (isHost && window.location.hostname === 'localhost') {
    const ipElement = document.createElement('div');
    ipElement.className = 'participant-ip';
    ipElement.textContent = ip;
    details.appendChild(ipElement);
  }
  
  return item;
}

// Update participants management (for host)
function updateParticipantsManagement() {
  if (!isHost) return;
  
  participantsManagement.innerHTML = '';
  
  Object.keys(participants).forEach(participantId => {
    const participant = participants[participantId];
    const managementItem = document.createElement('div');
    managementItem.className = 'management-item';
    
    const info = document.createElement('div');
    info.textContent = `${participant.name} (${participant.ip})`;
    
    const controls = document.createElement('div');
    controls.className = 'management-controls';
    
    // Mute/Unmute button
    const muteBtn = document.createElement('button');
    muteBtn.className = 'management-btn';
    muteBtn.textContent = participant.muted ? 'Unmute' : 'Mute';
    muteBtn.addEventListener('click', () => toggleParticipantMute(participantId));
    
    // Kick button
    const kickBtn = document.createElement('button');
    kickBtn.className = 'management-btn danger';
    kickBtn.textContent = 'Kick';
    kickBtn.addEventListener('click', () => kickParticipant(participantId));
    
    controls.appendChild(muteBtn);
    controls.appendChild(kickBtn);
    
    managementItem.appendChild(info);
    managementItem.appendChild(controls);
    
    participantsManagement.appendChild(managementItem);
  });
}

// Toggle participant mute (for host)
function toggleParticipantMute(participantId) {
  const participant = participants[participantId];
  participant.muted = !participant.muted;
  
  // Send mute/unmute command to participant
  if (connections[participantId]) {
    connections[participantId].send({
      type: participant.muted ? 'mute' : 'unmute'
    });
  }
  
  // Update UI
  updateParticipantsManagement();
  showToast(`${participant.name} has been ${participant.muted ? 'muted' : 'unmuted'}`);
}

// Kick participant (for host)
function kickParticipant(participantId) {
  const participant = participants[participantId];
  
  if (confirm(`Are you sure you want to kick ${participant.name}?`)) {
    // Send kick command to participant
    if (connections[participantId]) {
      connections[participantId].send({
        type: 'kick'
      });
    }
    
    // Remove participant video
    const videoElement = document.getElementById(`video-${participantId}`);
    if (videoElement) {
      videoElement.remove();
    }
    
    // Remove from participants list
    delete participants[participantId];
    
    // Close connection
    if (connections[participantId]) {
      connections[participantId].close();
      delete connections[participantId];
    }
    
    // Update UI
    updateParticipantsList();
    updateParticipantsManagement();
    showToast(`${participant.name} has been removed from the meeting`);
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

// Show toast notification
function showToast(message) {
  const toastMessage = document.getElementById('toast-message');
  toastMessage.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Initialize the meeting room when the page loads
document.addEventListener('DOMContentLoaded', initMeetingRoom);