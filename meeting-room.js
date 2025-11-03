// Global variables
let peer;
let localStream;
let isHost = false;
let meetingData;
let participants = {};
let connections = {};
let screenStream = null;
let meetingTimer;
let seconds = 0;

// DOM elements
const videoGrid = document.getElementById('video-grid');
const hostVideo = document.getElementById('host-video');
const hostName = document.getElementById('host-name');
const hostIp = document.getElementById('host-ip');
const ipAddressElement = document.getElementById('ip-address');
const meetingIdElement = document.getElementById('meeting-id');
const meetingTimerElement = document.getElementById('meeting-timer');
const micBtn = document.getElementById('mic-btn');
const videoBtn = document.getElementById('video-btn');
const screenShareBtn = document.getElementById('screen-share-btn');
const chatBtn = document.getElementById('chat-btn');
const participantsBtn = document.getElementById('participants-btn');
const securityBtn = document.getElementById('security-btn');
const leaveBtn = document.getElementById('leave-btn');
const chatPanel = document.getElementById('chat-panel');
const participantsPanel = document.getElementById('participants-panel');
const securityPanel = document.getElementById('security-panel');
const joinRequestModal = document.getElementById('join-request-modal');
const requesterName = document.getElementById('requester-name');
const requesterIp = document.getElementById('requester-ip');
const acceptRequestBtn = document.getElementById('accept-request');
const declineRequestBtn = document.getElementById('decline-request');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');
const participantsList = document.getElementById('participants-list');
const participantsManagement = document.getElementById('participants-management');
const notificationContainer = document.getElementById('notification-container');

// Initialize the meeting room
async function initMeetingRoom() {
  try {
    // Get meeting data from localStorage
    const storedData = localStorage.getItem('meetingData');
    if (!storedData) {
      showNotification('Meeting data not found. Redirecting to home...', 'error');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      return;
    }

    meetingData = JSON.parse(storedData);
    isHost = meetingData.isHost;

    // Set up UI based on host/participant role
    if (isHost) {
      document.body.classList.add('host-mode');
      hostName.textContent = 'You (Host)';
    } else {
      hostName.textContent = meetingData.username;
      // Hide host-only buttons for participants
      document.querySelectorAll('.host-only').forEach(el => {
        el.style.display = 'none';
      });
    }

    // Display IP and meeting ID
    ipAddressElement.textContent = `IP: ${meetingData.hostIP}`;
    meetingIdElement.textContent = `Meeting ID: ${meetingData.meetingID}`;
    hostIp.textContent = meetingData.hostIP;

    // Initialize PeerJS
    await initializePeerJS();

    // Get user media
    await getUserMedia();

    // Set up event listeners
    setupEventListeners();

    // Start meeting timer
    startMeetingTimer();

    // If participant, connect to host
    if (!isHost) {
      connectToHost();
    }

    showNotification('Meeting room initialized successfully', 'success');
  } catch (error) {
    console.error('Error initializing meeting room:', error);
    showNotification('Failed to initialize meeting room', 'error');
  }
}

// Initialize PeerJS
async function initializePeerJS() {
  return new Promise((resolve, reject) => {
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
        resolve();
      });

      peer.on('error', function(err) {
        console.error('PeerJS error:', err);
        reject(err);
      });

      // Handle incoming connections (for hosts)
      if (isHost) {
        peer.on('connection', function(conn) {
          console.log('Incoming connection from:', conn.peer);
          handleIncomingConnection(conn);
        });

        peer.on('call', function(call) {
          console.log('Incoming call from:', call.peer);
          handleIncomingCall(call);
        });
      }
    } catch (error) {
      reject(error);
    }
  });
}

// Get user media (camera and microphone)
async function getUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    hostVideo.srcObject = localStream;
    
    // Set initial button states
    micBtn.classList.add('active');
    videoBtn.classList.add('active');
  } catch (error) {
    console.error('Error accessing media devices:', error);
    showNotification('Failed to access camera or microphone', 'error');
  }
}

// Connect to host (for participants)
function connectToHost() {
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
      
      connections[meetingData.hostPeerId] = conn;
    });
    
    conn.on('data', function(data) {
      handleHostMessage(data);
    });
    
    conn.on('error', function(err) {
      console.error('Connection error:', err);
      showNotification('Connection to host failed', 'error');
    });
  } catch (error) {
    console.error('Error connecting to host:', error);
    showNotification('Failed to connect to host', 'error');
  }
}

// Handle incoming connections (for hosts)
function handleIncomingConnection(conn) {
  conn.on('data', function(data) {
    handleParticipantMessage(conn, data);
  });
  
  conn.on('close', function() {
    handleParticipantDisconnect(conn.peer);
  });
}

// Handle incoming calls (for hosts)
function handleIncomingCall(call) {
  call.answer(localStream);
  
  call.on('stream', function(remoteStream) {
    const participantId = call.peer;
    if (!participants[participantId]) {
      participants[participantId] = {
        id: participantId,
        name: 'Unknown',
        ip: 'Unknown',
        stream: remoteStream,
        muted: false,
        videoEnabled: true
      };
    }
    
    participants[participantId].stream = remoteStream;
    addVideoElement(participantId, remoteStream);
    updateParticipantsList();
  });
}

// Handle messages from participants (for hosts)
function handleParticipantMessage(conn, data) {
  switch (data.type) {
    case 'join-request':
      showJoinRequest(conn, data);
      break;
    case 'chat-message':
      displayChatMessage(data.username, data.message, false);
      // Broadcast message to all participants
      broadcastMessage(data);
      break;
    default:
      console.log('Unknown message type:', data.type);
  }
}

// Handle messages from host (for participants)
function handleHostMessage(data) {
  switch (data.type) {
    case 'join-accepted':
      showNotification('You have been admitted to the meeting', 'success');
      // Call the host to send our video stream
      callHost();
      break;
    case 'join-declined':
      showNotification('Your join request was declined', 'error');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      break;
    case 'chat-message':
      displayChatMessage(data.username, data.message, false);
      break;
    case 'mute':
      if (data.participantId === peer.id) {
        toggleMic(false); // Force mute
        showNotification('You have been muted by the host', 'info');
      }
      break;
    case 'unmute':
      if (data.participantId === peer.id) {
        toggleMic(true); // Force unmute
        showNotification('You have been unmuted by the host', 'info');
      }
      break;
    case 'kick':
      if (data.participantId === peer.id) {
        showNotification('You have been removed from the meeting', 'error');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 2000);
      }
      break;
    case 'participant-list':
      updateParticipantsListFromHost(data.participants);
      break;
    default:
      console.log('Unknown message type:', data.type);
  }
}

// Call the host (for participants)
function callHost() {
  try {
    const call = peer.call(meetingData.hostPeerId, localStream);
    
    call.on('stream', function(remoteStream) {
      // Add host video to the grid
      addVideoElement('host', remoteStream, 'Host');
    });
    
    call.on('error', function(err) {
      console.error('Call error:', err);
    });
  } catch (error) {
    console.error('Error calling host:', error);
  }
}

// Show join request modal (for hosts)
function showJoinRequest(conn, data) {
  requesterName.textContent = data.username;
  requesterIp.textContent = data.ip;
  joinRequestModal.classList.add('active');
  
  acceptRequestBtn.onclick = function() {
    acceptParticipant(conn, data);
    joinRequestModal.classList.remove('active');
  };
  
  declineRequestBtn.onclick = function() {
    declineParticipant(conn, data);
    joinRequestModal.classList.remove('active');
  };
}

// Accept participant (for hosts)
function acceptParticipant(conn, data) {
  // Store participant info
  participants[data.participantId] = {
    id: data.participantId,
    name: data.username,
    ip: data.ip,
    conn: conn,
    muted: false,
    videoEnabled: true
  };
  
  connections[data.participantId] = conn;
  
  // Send acceptance message
  conn.send({
    type: 'join-accepted'
  });
  
  // Update participants list
  updateParticipantsList();
  
  // Send updated participant list to all participants
  broadcastParticipantList();
  
  showNotification(`${data.username} has joined the meeting`, 'success');
}

// Decline participant (for hosts)
function declineParticipant(conn, data) {
  conn.send({
    type: 'join-declined'
  });
  
  conn.close();
  
  showNotification(`Join request from ${data.username} declined`, 'info');
}

// Handle participant disconnect (for hosts)
function handleParticipantDisconnect(participantId) {
  if (participants[participantId]) {
    const name = participants[participantId].name;
    delete participants[participantId];
    delete connections[participantId];
    
    // Remove video element
    const videoElement = document.getElementById(`video-${participantId}`);
    if (videoElement) {
      videoElement.remove();
    }
    
    // Update participants list
    updateParticipantsList();
    
    // Send updated participant list to all participants
    broadcastParticipantList();
    
    showNotification(`${name} has left the meeting`, 'info');
  }
}

// Add video element to the grid
function addVideoElement(participantId, stream, name) {
  // Check if video element already exists
  let videoWrapper = document.getElementById(`video-${participantId}`);
  
  if (!videoWrapper) {
    // Create new video wrapper
    videoWrapper = document.createElement('div');
    videoWrapper.id = `video-${participantId}`;
    videoWrapper.className = 'video-wrapper';
    
    // Create video element
    const video = document.createElement('video');
    video.id = `video-stream-${participantId}`;
    video.autoplay = true;
    video.playsinline = true;
    
    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name || participants[participantId]?.name || 'Unknown';
    
    const ipSpan = document.createElement('span');
    ipSpan.className = 'ip-display';
    ipSpan.textContent = participants[participantId]?.ip || '';
    ipSpan.style.display = isHost ? 'block' : 'none'; // Only show IP to host
    
    label.appendChild(nameSpan);
    label.appendChild(ipSpan);
    
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(label);
    
    videoGrid.appendChild(videoWrapper);
  }
  
  // Set video stream
  const video = document.getElementById(`video-stream-${participantId}`);
  if (video) {
    video.srcObject = stream;
  }
}

// Update participants list
function updateParticipantsList() {
  // Clear current list
  participantsList.innerHTML = '';
  participantsManagement.innerHTML = '';
  
  // Add host to the list
  const hostItem = createParticipantItem({
    id: 'host',
    name: isHost ? 'You (Host)' : 'Host',
    ip: meetingData.hostIP,
    isHost: true
  });
  participantsList.appendChild(hostItem);
  
  // Add all participants
  for (const id in participants) {
    const participant = participants[id];
    const participantItem = createParticipantItem(participant);
    participantsList.appendChild(participantItem);
    
    // Add to management section if host
    if (isHost) {
      const managementItem = createManagementItem(participant);
      participantsManagement.appendChild(managementItem);
    }
  }
}

// Create participant item for the list
function createParticipantItem(participant) {
  const item = document.createElement('div');
  item.className = 'participant-item';
  
  const info = document.createElement('div');
  info.className = 'participant-info';
  
  const avatar = document.createElement('div');
  avatar.className = 'participant-avatar';
  avatar.textContent = participant.name.charAt(0).toUpperCase();
  
  const details = document.createElement('div');
  details.className = 'participant-details';
  
  const name = document.createElement('div');
  name.className = 'participant-name';
  name.textContent = participant.name;
  
  const ip = document.createElement('div');
  ip.className = 'participant-ip';
  ip.textContent = participant.ip;
  ip.style.display = isHost ? 'block' : 'none'; // Only show IP to host
  
  details.appendChild(name);
  details.appendChild(ip);
  
  info.appendChild(avatar);
  info.appendChild(details);
  
  const controls = document.createElement('div');
  controls.className = 'participant-controls';
  
  // Add microphone status
  const micStatus = document.createElement('button');
  micStatus.innerHTML = participant.muted ? 
    '<i class="fas fa-microphone-slash"></i>' : 
    '<i class="fas fa-microphone"></i>';
  micStatus.title = participant.muted ? 'Muted' : 'Unmuted';
  micStatus.disabled = !isHost && !participant.isHost; // Only host can control others' mics
  
  controls.appendChild(micStatus);
  info.appendChild(controls);
  item.appendChild(info);
  
  return item;
}

// Create management item for security panel
function createManagementItem(participant) {
  const item = document.createElement('div');
  item.className = 'management-item';
  
  const info = document.createElement('div');
  info.textContent = `${participant.name} (${participant.ip})`;
  
  const actions = document.createElement('div');
  actions.className = 'management-actions';
  
  // Mute/Unmute button
  const muteBtn = document.createElement('button');
  muteBtn.className = 'mute-btn';
  muteBtn.textContent = participant.muted ? 'Unmute' : 'Mute';
  muteBtn.onclick = function() {
    toggleParticipantMute(participant.id, !participant.muted);
  };
  
  // Kick button
  const kickBtn = document.createElement('button');
  kickBtn.className = 'kick-btn';
  kickBtn.textContent = 'Kick';
  kickBtn.onclick = function() {
    kickParticipant(participant.id);
  };
  
  actions.appendChild(muteBtn);
  actions.appendChild(kickBtn);
  
  item.appendChild(info);
  item.appendChild(actions);
  
  return item;
}

// Toggle participant mute (for hosts)
function toggleParticipantMute(participantId, mute) {
  if (participants[participantId]) {
    participants[participantId].muted = mute;
    
    // Send mute/unmute command to participant
    if (connections[participantId]) {
      connections[participantId].send({
        type: mute ? 'mute' : 'unmute',
        participantId: participantId
      });
    }
    
    // Update UI
    updateParticipantsList();
    
    showNotification(
      `${participants[participantId].name} has been ${mute ? 'muted' : 'unmuted'}`,
      'info'
    );
  }
}

// Kick participant (for hosts)
function kickParticipant(participantId) {
  if (participants[participantId]) {
    const name = participants[participantId].name;
    
    // Send kick command to participant
    if (connections[participantId]) {
      connections[participantId].send({
        type: 'kick',
        participantId: participantId
      });
      
      // Close connection
      connections[participantId].close();
    }
    
    // Remove participant
    delete participants[participantId];
    delete connections[participantId];
    
    // Remove video element
    const videoElement = document.getElementById(`video-${participantId}`);
    if (videoElement) {
      videoElement.remove();
    }
    
    // Update UI
    updateParticipantsList();
    
    // Send updated participant list to all participants
    broadcastParticipantList();
    
    showNotification(`${name} has been removed from the meeting`, 'info');
  }
}

// Broadcast message to all participants (for hosts)
function broadcastMessage(message) {
  for (const id in connections) {
    connections[id].send(message);
  }
}

// Broadcast participant list to all participants (for hosts)
function broadcastParticipantList() {
  if (!isHost) return;
  
  // Create participant list for broadcasting
  const participantList = {
    host: {
      id: 'host',
      name: 'Host',
      ip: meetingData.hostIP
    }
  };
  
  for (const id in participants) {
    participantList[id] = {
      id: participants[id].id,
      name: participants[id].name,
      ip: participants[id].ip
    };
  }
  
  // Send to all participants
  for (const id in connections) {
    connections[id].send({
      type: 'participant-list',
      participants: participantList
    });
  }
}

// Update participants list from host data (for participants)
function updateParticipantsListFromHost(participantList) {
  // Clear current list
  participantsList.innerHTML = '';
  
  // Add all participants from host data
  for (const id in participantList) {
    const participant = participantList[id];
    const participantItem = createParticipantItem(participant);
    participantsList.appendChild(participantItem);
  }
}

// Toggle microphone
function toggleMic(forceState = null) {
  if (localStream) {
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const newState = forceState !== null ? forceState : !audioTracks[0].enabled;
      audioTracks[0].enabled = newState;
      
      // Update button state
      if (newState) {
        micBtn.classList.add('active');
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      } else {
        micBtn.classList.remove('active');
        micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
      }
      
      // Only hosts can control their own mic, participants need host permission
      if (!isHost && forceState === null) {
        showNotification('Only the host can control your microphone', 'error');
        // Revert the change
        audioTracks[0].enabled = true;
        micBtn.classList.add('active');
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      }
    }
  }
}

// Toggle video
function toggleVideo() {
  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoTracks[0].enabled = !videoTracks[0].enabled;
      
      // Update button state
      if (videoTracks[0].enabled) {
        videoBtn.classList.add('active');
        videoBtn.innerHTML = '<i class="fas fa-video"></i>';
      } else {
        videoBtn.classList.remove('active');
        videoBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
      }
    }
  }
}

// Toggle screen sharing
async function toggleScreenShare() {
  try {
    if (!screenStream) {
      // Start screen sharing
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      // Replace host video with screen share
      hostVideo.srcObject = screenStream;
      
      // Update button state
      screenShareBtn.classList.add('active');
      
      // Notify participants about screen share
      if (isHost) {
        broadcastMessage({
          type: 'screen-share-started'
        });
      }
      
      // Handle screen share ending
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });
    } else {
      // Stop screen sharing
      stopScreenShare();
    }
  } catch (error) {
    console.error('Error toggling screen share:', error);
    showNotification('Failed to share screen', 'error');
  }
}

// Stop screen sharing
function stopScreenShare() {
  if (screenStream) {
    // Stop all tracks
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
    
    // Restore host video
    hostVideo.srcObject = localStream;
    
    // Update button state
    screenShareBtn.classList.remove('active');
    
    // Notify participants about screen share ending
    if (isHost) {
      broadcastMessage({
        type: 'screen-share-stopped'
      });
    }
  }
}

// Send chat message
function sendChatMessage() {
  const message = chatInput.value.trim();
  if (message) {
    const username = isHost ? 'Host' : meetingData.username;
    
    // Display message in own chat
    displayChatMessage(username, message, true);
    
    // Send message to host or broadcast to all participants
    if (isHost) {
      // Broadcast to all participants
      broadcastMessage({
        type: 'chat-message',
        username: username,
        message: message
      });
    } else {
      // Send to host
      if (connections[meetingData.hostPeerId]) {
        connections[meetingData.hostPeerId].send({
          type: 'chat-message',
          username: username,
          message: message
        });
      }
    }
    
    // Clear input
    chatInput.value = '';
  }
}

// Display chat message
function displayChatMessage(username, message, isOwn) {
  const messageElement = document.createElement('div');
  messageElement.className = `chat-message ${isOwn ? 'own' : ''}`;
  
  const header = document.createElement('div');
  header.className = 'chat-message-header';
  header.innerHTML = `
    <span>${username}</span>
    <span>${new Date().toLocaleTimeString()}</span>
  `;
  
  const content = document.createElement('div');
  content.textContent = message;
  
  messageElement.appendChild(header);
  messageElement.appendChild(content);
  
  chatMessages.appendChild(messageElement);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  notificationContainer.appendChild(notification);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// Start meeting timer
function startMeetingTimer() {
  meetingTimer = setInterval(() => {
    seconds++;
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    meetingTimerElement.textContent = 
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

// Leave meeting
function leaveMeeting() {
  if (confirm('Are you sure you want to leave the meeting?')) {
    // Close all connections
    for (const id in connections) {
      connections[id].close();
    }
    
    // Destroy peer connection
    if (peer && !peer.destroyed) {
      peer.destroy();
    }
    
    // Stop all media streams
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
    }
    
    // Clear meeting timer
    clearInterval(meetingTimer);
    
    // Redirect to home
    window.location.href = 'index.html';
  }
}

// Setup event listeners
function setupEventListeners() {
  // Control buttons
  micBtn.addEventListener('click', () => toggleMic());
  videoBtn.addEventListener('click', toggleVideo);
  screenShareBtn.addEventListener('click', toggleScreenShare);
  leaveBtn.addEventListener('click', leaveMeeting);
  
  // Panel buttons
  chatBtn.addEventListener('click', () => {
    chatPanel.classList.toggle('active');
    participantsPanel.classList.remove('active');
    securityPanel.classList.remove('active');
  });
  
  participantsBtn.addEventListener('click', () => {
    participantsPanel.classList.toggle('active');
    chatPanel.classList.remove('active');
    securityPanel.classList.remove('active');
  });
  
  securityBtn.addEventListener('click', () => {
    securityPanel.classList.toggle('active');
    chatPanel.classList.remove('active');
    participantsPanel.classList.remove('active');
  });
  
  // Close panel buttons
  document.getElementById('close-chat').addEventListener('click', () => {
    chatPanel.classList.remove('active');
  });
  
  document.getElementById('close-participants').addEventListener('click', () => {
    participantsPanel.classList.remove('active');
  });
  
  document.getElementById('close-security').addEventListener('click', () => {
    securityPanel.classList.remove('active');
  });
  
  // Chat input
  sendMessageBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    }
  });
  
  // Window resize
  window.addEventListener('resize', () => {
    // Adjust video grid layout
    const videoCount = videoGrid.children.length;
    if (videoCount <= 1) {
      videoGrid.style.gridTemplateColumns = '1fr';
    } else if (videoCount <= 4) {
      videoGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else if (videoCount <= 9) {
      videoGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    } else {
      videoGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
    }
  });
  
  // Before unload
  window.addEventListener('beforeunload', () => {
    // Clean up resources
    if (peer && !peer.destroyed) {
      peer.destroy();
    }
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
    }
    
    clearInterval(meetingTimer);
  });
}

// Initialize the meeting room when the page loads
window.addEventListener('DOMContentLoaded', initMeetingRoom);