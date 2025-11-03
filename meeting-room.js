// Global variables
let peer;
let localStream;
let isHost = false;
let meetingData;
let participants = {};
let waitingParticipants = {};
let connections = {};
let screenShareStream = null;

// DOM elements
const localVideo = document.getElementById('local-video');
const localVideoName = document.getElementById('local-video-name');
const localMuteIndicator = document.getElementById('local-mute-indicator');
const ipAddressElement = document.getElementById('ip-address');
const meetingIdElement = document.getElementById('meeting-id');
const userNameElement = document.getElementById('user-name');
const videoContainer = document.getElementById('video-container');
const micBtn = document.getElementById('mic-btn');
const videoBtn = document.getElementById('video-btn');
const screenShareBtn = document.getElementById('screen-share-btn');
const securityBtn = document.getElementById('security-btn');
const participantsBtn = document.getElementById('participants-btn');
const chatBtn = document.getElementById('chat-btn');
const leaveMeetingBtn = document.getElementById('leave-meeting');
const endMeetingBtn = document.getElementById('end-meeting-btn');

// Modal elements
const waitingRoomModal = document.getElementById('waiting-room-modal');
const participantsModal = document.getElementById('participants-modal');
const chatModal = document.getElementById('chat-modal');
const waitingParticipantsList = document.getElementById('waiting-participants-list');
const participantsList = document.getElementById('participants-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageBtn = document.getElementById('send-message');

// Initialize the meeting room
async function initMeetingRoom() {
  try {
    // Get meeting data from localStorage
    const storedData = localStorage.getItem('meetingData');
    if (!storedData) {
      showToast('No meeting data found. Redirecting to home...');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      return;
    }

    meetingData = JSON.parse(storedData);
    isHost = meetingData.isHost;

    // Set UI elements
    userNameElement.textContent = meetingData.username;
    meetingIdElement.textContent = `Meeting ID: ${meetingData.meetingID}`;
    
    // Get and display IP address
    const ipAddress = await getLocalIP();
    ipAddressElement.textContent = `IP: ${ipAddress}`;

    // Initialize PeerJS
    await initializePeerJS();

    // Get user media
    await getUserMedia();

    // Set up event listeners
    setupEventListeners();

    // If host, set up waiting room
    if (isHost) {
      setupWaitingRoom();
    } else {
      // If participant, request to join
      requestToJoin();
    }

  } catch (error) {
    console.error('Error initializing meeting room:', error);
    showToast('Failed to initialize meeting room');
  }
}

// Initialize PeerJS
async function initializePeerJS() {
  return new Promise((resolve, reject) => {
    try {
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

      // Handle incoming connections
      peer.on('connection', function(conn) {
        handleIncomingConnection(conn);
      });

      // Handle incoming calls
      peer.on('call', function(call) {
        handleIncomingCall(call);
      });

    } catch (error) {
      console.error('Failed to initialize PeerJS:', error);
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
    
    localVideo.srcObject = localStream;
    
    // Update local video name
    localVideoName.textContent = meetingData.username;
    
    // Set initial button states
    updateButtonStates();
    
  } catch (error) {
    console.error('Error getting user media:', error);
    showToast('Failed to access camera and microphone');
  }
}

// Set up event listeners
function setupEventListeners() {
  // Mic button
  micBtn.addEventListener('click', toggleMic);
  
  // Video button
  videoBtn.addEventListener('click', toggleVideo);
  
  // Screen share button
  screenShareBtn.addEventListener('click', toggleScreenShare);
  
  // Security button (host only)
  if (isHost) {
    securityBtn.addEventListener('click', () => {
      participantsModal.style.display = 'flex';
      updateParticipantsList();
    });
  } else {
    securityBtn.style.display = 'none';
  }
  
  // Participants button
  participantsBtn.addEventListener('click', () => {
    if (isHost) {
      participantsModal.style.display = 'flex';
      updateParticipantsList();
    } else {
      showToast('Only the host can manage participants');
    }
  });
  
  // Chat button
  chatBtn.addEventListener('click', () => {
    chatModal.style.display = 'flex';
  });
  
  // Leave meeting button
  leaveMeetingBtn.addEventListener('click', leaveMeeting);
  
  // End meeting button (host only)
  if (isHost) {
    endMeetingBtn.addEventListener('click', endMeeting);
  } else {
    endMeetingBtn.style.display = 'none';
  }
  
  // Modal close buttons
  document.getElementById('close-waiting-room').addEventListener('click', () => {
    waitingRoomModal.style.display = 'none';
  });
  
  document.getElementById('close-participants').addEventListener('click', () => {
    participantsModal.style.display = 'none';
  });
  
  document.getElementById('close-chat').addEventListener('click', () => {
    chatModal.style.display = 'none';
  });
  
  // Chat input
  sendMessageBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage();
    }
  });
  
  // Clean up on page unload
  window.addEventListener('beforeunload', cleanup);
}

// Toggle microphone
function toggleMic() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      updateButtonStates();
    }
  }
}

// Toggle video
function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      updateButtonStates();
    }
  }
}

// Toggle screen share
async function toggleScreenShare() {
  try {
    if (screenShareStream) {
      // Stop screen share
      screenShareStream.getTracks().forEach(track => track.stop());
      screenShareStream = null;
      
      // Switch back to camera
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        localVideo.srcObject = localStream;
      }
      
      // Notify all participants
      broadcastMessage({
        type: 'screenShareStopped'
      });
      
      updateButtonStates();
    } else {
      // Start screen share
      screenShareStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      // Replace local video with screen share
      localVideo.srcObject = screenShareStream;
      
      // Handle screen share end
      screenShareStream.getVideoTracks()[0].addEventListener('ended', () => {
        toggleScreenShare();
      });
      
      // Notify all participants
      broadcastMessage({
        type: 'screenShareStarted',
        peerId: peer.id
      });
      
      updateButtonStates();
    }
  } catch (error) {
    console.error('Error toggling screen share:', error);
    showToast('Failed to share screen');
  }
}

// Update button states based on current media state
function updateButtonStates() {
  // Update mic button
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      if (audioTrack.enabled) {
        micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        micBtn.classList.remove('active');
        localMuteIndicator.style.display = 'none';
      } else {
        micBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        micBtn.classList.add('active');
        localMuteIndicator.style.display = 'block';
      }
    }
  }
  
  // Update video button
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      if (videoTrack.enabled) {
        videoBtn.innerHTML = '<i class="fas fa-video"></i>';
        videoBtn.classList.remove('active');
      } else {
        videoBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        videoBtn.classList.add('active');
      }
    }
  }
  
  // Update screen share button
  if (screenShareStream) {
    screenShareBtn.innerHTML = '<i class="fas fa-stop"></i>';
    screenShareBtn.classList.add('active');
  } else {
    screenShareBtn.innerHTML = '<i class="fas fa-desktop"></i>';
    screenShareBtn.classList.remove('active');
  }
}

// Setup waiting room (host only)
function setupWaitingRoom() {
  waitingRoomModal.style.display = 'flex';
}

// Request to join meeting (participant only)
function requestToJoin() {
  try {
    // Connect to host
    const conn = peer.connect(meetingData.hostPeerId, {
      reliable: true
    });
    
    conn.on('open', function() {
      console.log('Connected to host:', meetingData.hostPeerId);
      
      // Send join request with participant info
      conn.send({
        type: 'joinRequest',
        participantId: peer.id,
        username: meetingData.username,
        ipAddress: meetingData.hostIP
      });
      
      // Store connection
      connections[meetingData.hostPeerId] = conn;
    });
    
    conn.on('data', function(data) {
      handleDataFromHost(data);
    });
    
    conn.on('error', function(err) {
      console.error('Connection error:', err);
      showToast('Failed to connect to host');
    });
    
  } catch (error) {
    console.error('Error requesting to join:', error);
    showToast('Failed to join meeting');
  }
}

// Handle incoming connection (host only)
function handleIncomingConnection(conn) {
  if (!isHost) return;
  
  conn.on('open', function() {
    console.log('Incoming connection from:', conn.peer);
    
    // Store connection
    connections[conn.peer] = conn;
  });
  
  conn.on('data', function(data) {
    handleDataFromParticipant(conn.peer, data);
  });
  
  conn.on('close', function() {
    console.log('Connection closed:', conn.peer);
    removeParticipant(conn.peer);
    delete connections[conn.peer];
  });
}

// Handle incoming call
function handleIncomingCall(call) {
  // Answer the call with our local stream
  call.answer(localStream);
  
  // Handle the stream
  call.on('stream', function(remoteStream) {
    addVideoStream(call.peer, remoteStream);
  });
  
  call.on('close', function() {
    removeVideoStream(call.peer);
  });
}

// Handle data from participant (host only)
function handleDataFromParticipant(peerId, data) {
  if (!isHost) return;
  
  switch (data.type) {
    case 'joinRequest':
      // Add to waiting room
      waitingParticipants[peerId] = {
        username: data.username,
        ipAddress: data.ipAddress
      };
      updateWaitingRoomList();
      showToast(`${data.username} is waiting to join`);
      break;
      
    case 'chatMessage':
      // Broadcast chat message to all participants
      broadcastMessage({
        type: 'chatMessage',
        sender: data.username,
        content: data.content
      });
      
      // Add to host's chat
      addChatMessage(data.username, data.content);
      break;
      
    default:
      console.log('Unknown data type:', data.type);
  }
}

// Handle data from host (participant only)
function handleDataFromHost(data) {
  if (isHost) return;
  
  switch (data.type) {
    case 'joinAccepted':
      // Join accepted, connect to other participants
      showToast('You have been admitted to the meeting');
      connectToParticipants(data.participants);
      break;
      
    case 'joinRejected':
      // Join rejected
      showToast('Your request to join was rejected');
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
      break;
      
    case 'participantJoined':
      // New participant joined
      connectToPeer(data.participantId);
      break;
      
    case 'participantLeft':
      // Participant left
      removeParticipant(data.participantId);
      break;
      
    case 'muteParticipant':
      // Host muted this participant
      if (data.participantId === peer.id) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = false;
          updateButtonStates();
          showToast('You have been muted by the host');
        }
      }
      break;
      
    case 'unmuteParticipant':
      // Host unmuted this participant
      if (data.participantId === peer.id) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = true;
          updateButtonStates();
          showToast('You have been unmuted by the host');
        }
      }
      break;
      
    case 'kickParticipant':
      // Host kicked this participant
      if (data.participantId === peer.id) {
        showToast('You have been removed from the meeting');
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 2000);
      }
      break;
      
    case 'chatMessage':
      // Chat message from host
      addChatMessage(data.sender, data.content);
      break;
      
    case 'screenShareStarted':
      // Host started screen share
      if (data.peerId !== peer.id) {
        // Request screen share stream
        const call = peer.call(data.peerId, localStream);
        call.on('stream', function(remoteStream) {
          // Find the video element for this participant
          const videoWrapper = document.getElementById(`video-wrapper-${data.peerId}`);
          if (videoWrapper) {
            const video = videoWrapper.querySelector('video');
            if (video) {
              video.srcObject = remoteStream;
            }
          }
        });
      }
      break;
      
    case 'screenShareStopped':
      // Host stopped screen share
      // Find the video element for this participant and restore camera
      const videoWrapper = document.getElementById(`video-wrapper-${data.peerId}`);
      if (videoWrapper) {
        // Re-establish call to get camera stream
        const call = peer.call(data.peerId, localStream);
        call.on('stream', function(remoteStream) {
          const video = videoWrapper.querySelector('video');
          if (video) {
            video.srcObject = remoteStream;
          }
        });
      }
      break;
      
    default:
      console.log('Unknown data type:', data.type);
  }
}

// Connect to participants (after being accepted)
function connectToParticipants(participantIds) {
  participantIds.forEach(participantId => {
    if (participantId !== peer.id) {
      connectToPeer(participantId);
    }
  });
}

// Connect to a specific peer
function connectToPeer(peerId) {
  try {
    // Establish data connection
    const conn = peer.connect(peerId, {
      reliable: true
    });
    
    conn.on('open', function() {
      console.log('Connected to peer:', peerId);
      connections[peerId] = conn;
    });
    
    conn.on('data', function(data) {
      // Handle data from this peer
      if (data.type === 'chatMessage') {
        addChatMessage(data.sender, data.content);
      }
    });
    
    // Establish media connection
    const call = peer.call(peerId, localStream);
    
    call.on('stream', function(remoteStream) {
      addVideoStream(peerId, remoteStream);
    });
    
    call.on('close', function() {
      removeVideoStream(peerId);
    });
    
  } catch (error) {
    console.error('Error connecting to peer:', error);
  }
}

// Add video stream to the grid
function addVideoStream(peerId, stream) {
  // Check if video element already exists
  let videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
  
  if (!videoWrapper) {
    // Create new video wrapper
    videoWrapper = document.createElement('div');
    videoWrapper.id = `video-wrapper-${peerId}`;
    videoWrapper.className = 'video-wrapper';
    
    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    
    // Create label
    const label = document.createElement('div');
    label.className = 'video-label';
    
    const nameSpan = document.createElement('span');
    nameSpan.id = `video-name-${peerId}`;
    nameSpan.textContent = participants[peerId]?.username || 'Unknown';
    
    const muteIndicator = document.createElement('span');
    muteIndicator.className = 'mute-indicator';
    muteIndicator.id = `mute-indicator-${peerId}`;
    muteIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    muteIndicator.style.display = 'none';
    
    label.appendChild(nameSpan);
    label.appendChild(muteIndicator);
    
    videoWrapper.appendChild(video);
    videoWrapper.appendChild(label);
    
    videoContainer.appendChild(videoWrapper);
  }
  
  // Set the stream
  const video = videoWrapper.querySelector('video');
  if (video) {
    video.srcObject = stream;
  }
}

// Remove video stream from the grid
function removeVideoStream(peerId) {
  const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (videoWrapper) {
    videoWrapper.remove();
  }
}

// Update waiting room list (host only)
function updateWaitingRoomList() {
  waitingParticipantsList.innerHTML = '';
  
  Object.keys(waitingParticipants).forEach(peerId => {
    const participant = waitingParticipants[peerId];
    
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        <div class="participant-ip">IP: ${participant.ipAddress}</div>
      </div>
      <div class="participant-actions">
        <button class="action-btn accept-btn" data-peer-id="${peerId}" title="Accept">
          <i class="fas fa-check"></i>
        </button>
        <button class="action-btn reject-btn" data-peer-id="${peerId}" title="Reject">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    
    waitingParticipantsList.appendChild(li);
  });
  
  // Add event listeners to accept/reject buttons
  document.querySelectorAll('.accept-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const peerId = this.getAttribute('data-peer-id');
      acceptParticipant(peerId);
    });
  });
  
  document.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const peerId = this.getAttribute('data-peer-id');
      rejectParticipant(peerId);
    });
  });
}

// Accept participant (host only)
function acceptParticipant(peerId) {
  try {
    // Add to participants list
    participants[peerId] = waitingParticipants[peerId];
    
    // Remove from waiting room
    delete waitingParticipants[peerId];
    
    // Update UI
    updateWaitingRoomList();
    updateParticipantsList();
    
    // Notify participant
    const conn = connections[peerId];
    if (conn && conn.open) {
      conn.send({
        type: 'joinAccepted',
        participants: Object.keys(participants)
      });
    }
    
    // Notify other participants
    broadcastMessage({
      type: 'participantJoined',
      participantId: peerId
    }, peerId);
    
    // Call the participant to establish media connection
    const call = peer.call(peerId, localStream);
    
    call.on('stream', function(remoteStream) {
      addVideoStream(peerId, remoteStream);
    });
    
    call.on('close', function() {
      removeVideoStream(peerId);
    });
    
    showToast(`${participants[peerId].username} has joined the meeting`);
    
  } catch (error) {
    console.error('Error accepting participant:', error);
    showToast('Failed to accept participant');
  }
}

// Reject participant (host only)
function rejectParticipant(peerId) {
  try {
    const participant = waitingParticipants[peerId];
    
    // Remove from waiting room
    delete waitingParticipants[peerId];
    
    // Update UI
    updateWaitingRoomList();
    
    // Notify participant
    const conn = connections[peerId];
    if (conn && conn.open) {
      conn.send({
        type: 'joinRejected'
      });
      
      // Close connection
      conn.close();
    }
    
    showToast(`${participant.username} was rejected from the meeting`);
    
  } catch (error) {
    console.error('Error rejecting participant:', error);
    showToast('Failed to reject participant');
  }
}

// Update participants list (host only)
function updateParticipantsList() {
  if (!isHost) return;
  
  participantsList.innerHTML = '';
  
  // Add host
  const hostLi = document.createElement('li');
  hostLi.innerHTML = `
    <div class="participant-info">
      <div class="participant-name">${meetingData.username} (Host)</div>
      <div class="participant-ip">IP: ${meetingData.hostIP}</div>
    </div>
  `;
  participantsList.appendChild(hostLi);
  
  // Add participants
  Object.keys(participants).forEach(peerId => {
    const participant = participants[peerId];
    
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="participant-info">
        <div class="participant-name">${participant.username}</div>
        <div class="participant-ip">IP: ${participant.ipAddress}</div>
      </div>
      <div class="participant-actions">
        <button class="action-btn mute-btn" data-peer-id="${peerId}" title="Mute">
          <i class="fas fa-microphone-slash"></i>
        </button>
        <button class="action-btn kick-btn" data-peer-id="${peerId}" title="Kick">
          <i class="fas fa-user-times"></i>
        </button>
      </div>
    `;
    
    participantsList.appendChild(li);
  });
  
  // Add event listeners to action buttons
  document.querySelectorAll('.mute-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const peerId = this.getAttribute('data-peer-id');
      toggleParticipantMute(peerId);
    });
  });
  
  document.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const peerId = this.getAttribute('data-peer-id');
      kickParticipant(peerId);
    });
  });
}

// Toggle participant mute (host only)
function toggleParticipantMute(peerId) {
  try {
    const conn = connections[peerId];
    if (conn && conn.open) {
      // Check if participant is currently muted
      const isMuted = localStream.getAudioTracks()[0].enabled === false;
      
      // Send mute/unmute command
      conn.send({
        type: isMuted ? 'unmuteParticipant' : 'muteParticipant',
        participantId: peerId
      });
      
      // Update UI
      updateParticipantsList();
      
      showToast(`${participants[peerId].username} has been ${isMuted ? 'unmuted' : 'muted'}`);
    }
  } catch (error) {
    console.error('Error toggling participant mute:', error);
    showToast('Failed to toggle participant mute');
  }
}

// Kick participant (host only)
function kickParticipant(peerId) {
  try {
    const participant = participants[peerId];
    
    // Remove from participants
    delete participants[peerId];
    
    // Close connection
    const conn = connections[peerId];
    if (conn) {
      conn.send({
        type: 'kickParticipant',
        participantId: peerId
      });
      conn.close();
    }
    
    // Remove video
    removeVideoStream(peerId);
    
    // Update UI
    updateParticipantsList();
    
    // Notify other participants
    broadcastMessage({
      type: 'participantLeft',
      participantId: peerId
    });
    
    showToast(`${participant.username} has been removed from the meeting`);
    
  } catch (error) {
    console.error('Error kicking participant:', error);
    showToast('Failed to kick participant');
  }
}

// Remove participant
function removeParticipant(peerId) {
  if (participants[peerId]) {
    const participant = participants[peerId];
    delete participants[peerId];
    removeVideoStream(peerId);
    
    if (isHost) {
      updateParticipantsList();
      showToast(`${participant.username} has left the meeting`);
    }
  }
}

// Broadcast message to all connected peers
function broadcastMessage(message, excludePeerId) {
  Object.keys(connections).forEach(peerId => {
    if (peerId !== excludePeerId) {
      const conn = connections[peerId];
      if (conn && conn.open) {
        conn.send(message);
      }
    }
  });
}

// Send chat message
function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  
  // Add to local chat
  addChatMessage(meetingData.username, message);
  
  // Send to all participants
  if (isHost) {
    broadcastMessage({
      type: 'chatMessage',
      sender: meetingData.username,
      content: message
    });
  } else {
    // Send to host
    const conn = connections[meetingData.hostPeerId];
    if (conn && conn.open) {
      conn.send({
        type: 'chatMessage',
        sender: meetingData.username,
        content: message
      });
    }
  }
  
  // Clear input
  chatInput.value = '';
}

// Add chat message to UI
function addChatMessage(sender, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  const senderDiv = document.createElement('div');
  senderDiv.className = 'sender';
  senderDiv.textContent = sender;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  contentDiv.textContent = content;
  
  messageDiv.appendChild(senderDiv);
  messageDiv.appendChild(contentDiv);
  
  chatMessages.appendChild(messageDiv);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Leave meeting
function leaveMeeting() {
  if (confirm('Are you sure you want to leave the meeting?')) {
    cleanup();
    window.location.href = 'index.html';
  }
}

// End meeting (host only)
function endMeeting() {
  if (confirm('Are you sure you want to end the meeting for everyone?')) {
    // Notify all participants
    broadcastMessage({
      type: 'meetingEnded'
    });
    
    cleanup();
    window.location.href = 'index.html';
  }
}

// Clean up resources
function cleanup() {
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  // Stop screen share stream
  if (screenShareStream) {
    screenShareStream.getTracks().forEach(track => track.stop());
  }
  
  // Close all connections
  Object.keys(connections).forEach(peerId => {
    connections[peerId].close();
  });
  
  // Destroy peer connection
  if (peer && !peer.destroyed) {
    peer.destroy();
  }
  
  // Clear localStorage
  localStorage.removeItem('meetingData');
}

// Show toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Show toast
  setTimeout(() => {
    toast.classList.add('show');
  }, 100);
  
  // Hide toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 3000);
}

// Get local IP address
async function getLocalIP() {
  try {
    // Method 1: Try to get local IP using WebRTC
    const localIP = await getLocalIPUsingWebRTC();
    if (localIP) {
      return localIP;
    }
  } catch (error) {
    console.log('Could not get local IP:', error);
  }

  try {
    // Method 2: Get public IP using external service
    const publicIP = await getPublicIP();
    if (publicIP) {
      return publicIP;
    }
  } catch (error) {
    console.log('Could not get public IP:', error);
  }

  // Fallback: Return a placeholder
  return "IP_DETECTION_FAILED";
}

// Get local IP using WebRTC
async function getLocalIPUsingWebRTC() {
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.createDataChannel('');
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.candidate;
        const ipMatch = candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/);
        if (ipMatch) {
          const ip = ipMatch[1];
          // Filter out non-local IPs
          if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
            pc.close();
            resolve(ip);
          }
        }
      }
    };

    pc.createOffer().then(offer => pc.setLocalDescription(offer));
    
    // Timeout after 5 seconds
    setTimeout(() => {
      pc.close();
      resolve(null);
    }, 5000);
  });
}

// Get public IP
async function getPublicIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    // Fallback to another service
    try {
      const response = await fetch('https://ipapi.co/ip/');
      return await response.text();
    } catch (error2) {
      throw error2;
    }
  }
}

// Initialize the meeting room when the page loads
window.addEventListener('DOMContentLoaded', initMeetingRoom);