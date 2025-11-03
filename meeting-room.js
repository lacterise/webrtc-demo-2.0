class VideoMeetingApp {
    constructor() {
        this.peer = null;
        this.localStream = null;
        this.peers = {};
        this.peersInfo = {}; // Store peer information
        this.pendingRequests = {}; // Store pending join requests
        this.meetingId = null;
        this.isHost = false;
        this.userName = 'User';
        this.isMuted = false;
        this.isVideoOff = false;
        this.isScreenSharing = false;
        this.currentRequest = null; // Current join request being processed
        this.hostIp = null; // Store host IP address
        
        this.initializeElements();
        this.bindEvents();
        this.initializeMeeting();
    }
    
    initializeElements() {
        // Meeting room elements
        this.meetingRoom = document.getElementById('meetingRoom');
        this.localVideo = document.getElementById('localVideo');
        this.currentMeetingId = document.getElementById('currentMeetingId');
        this.hostIpDisplay = document.getElementById('hostIpDisplay');
        this.hostIp = document.getElementById('hostIp');
        this.videoContainer = document.getElementById('videoContainer');
        this.participantCount = document.getElementById('participantCount');
        this.sidebar = document.getElementById('sidebar');
        this.participantsPanel = document.getElementById('participantsPanel');
        this.securityPanel = document.getElementById('securityPanel');
        this.chatPanel = document.getElementById('chatPanel');
        this.participantsList = document.getElementById('participantsList');
        this.participantsManagement = document.getElementById('participantsManagement');
        this.waitingParticipants = document.getElementById('waitingParticipants');
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        
        // Control buttons
        this.micBtn = document.getElementById('micBtn');
        this.videoBtn = document.getElementById('videoBtn');
        this.screenShareBtn = document.getElementById('screenShareBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        this.endMeetingBtn = document.getElementById('endMeetingBtn');
        
        // Header buttons
        this.securityBtn = document.getElementById('securityBtn');
        this.participantsBtn = document.getElementById('participantsBtn');
        this.chatBtn = document.getElementById('chatBtn');
        this.closeParticipants = document.getElementById('closeParticipants');
        this.closeSecurity = document.getElementById('closeSecurity');
        this.closeChat = document.getElementById('closeChat');
        this.sendMessageBtn = document.getElementById('sendMessageBtn');
        
        // Modal elements
        this.joinRequestModal = document.getElementById('joinRequestModal');
        this.waitingModal = document.getElementById('waitingModal');
        this.requesterName = document.getElementById('requesterName');
        this.requestMeetingId = document.getElementById('requestMeetingId');
        this.acceptRequestBtn = document.getElementById('acceptRequestBtn');
        this.declineRequestBtn = document.getElementById('declineRequestBtn');
        this.cancelRequestBtn = document.getElementById('cancelRequestBtn');
        
        // Other elements
        this.toastContainer = document.getElementById('toastContainer');
    }
    
    bindEvents() {
        // Control bar events
        this.micBtn.addEventListener('click', () => this.toggleMic());
        this.videoBtn.addEventListener('click', () => this.toggleVideo());
        this.screenShareBtn.addEventListener('click', () => this.toggleScreenShare());
        this.leaveBtn.addEventListener('click', () => this.leaveMeeting());
        this.endMeetingBtn.addEventListener('click', () => this.endMeeting());
        
        // Header events
        this.securityBtn.addEventListener('click', () => this.showPanel('security'));
        this.participantsBtn.addEventListener('click', () => this.showPanel('participants'));
        this.chatBtn.addEventListener('click', () => this.showPanel('chat'));
        this.closeParticipants.addEventListener('click', () => this.hideSidebar());
        this.closeSecurity.addEventListener('click', () => this.hideSidebar());
        this.closeChat.addEventListener('click', () => this.hideSidebar());
        
        // Chat events
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Modal events
        this.acceptRequestBtn.addEventListener('click', () => this.acceptJoinRequest());
        this.declineRequestBtn.addEventListener('click', () => this.declineJoinRequest());
        this.cancelRequestBtn.addEventListener('click', () => this.cancelJoinRequest());
        
        // Determine meeting context (prefer localStorage from create.html)
        const storedMeetingDataRaw = localStorage.getItem('meetingData');
        if (storedMeetingDataRaw) {
            try {
                const storedMeetingData = JSON.parse(storedMeetingDataRaw);
                if (storedMeetingData && storedMeetingData.meetingID) {
                    this.meetingId = storedMeetingData.meetingID;
                    this.isHost = !!storedMeetingData.isHost;
                    this.userName = storedMeetingData.username || (this.isHost ? 'Host' : 'Participant');
                }
            } catch (_) {
                // Ignore parse errors and fall back to URL params
            }
        }

        // If not resolved by localStorage, fall back to URL or generate new
        if (!this.meetingId) {
            const urlParams = new URLSearchParams(window.location.search);
            this.meetingId = urlParams.get('meetingId') || this.generateMeetingId();
            this.isHost = !urlParams.has('meetingId');
            this.userName = urlParams.get('userName') || (this.isHost ? 'Host' : 'Participant');
        }
    }
    
    async initializeMeeting() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            // Set local video
            this.localVideo.srcObject = this.localStream;
            document.getElementById('localName').textContent = this.userName;
            
            // Initialize PeerJS
            this.peer = new Peer(this.isHost ? this.meetingId : undefined, {
                debug: 2
            });
            
            this.peer.on('open', (id) => {
                if (this.isHost) {
                    this.currentMeetingId.textContent = this.meetingId;
                    this.showToast(`Meeting started! ID: ${this.meetingId}`, 'success');
                    // Show security button for host
                    this.securityBtn.style.display = 'flex';
                    // Show end meeting button for host
                    this.endMeetingBtn.style.display = 'flex';
                    // Hide leave button for host
                    this.leaveBtn.style.display = 'none';
                    // Get and display host IP
                    this.getHostIp();
                } else {
                    this.currentMeetingId.textContent = this.meetingId;
                    // Hide security button for participants
                    this.securityBtn.style.display = 'none';
                    // Hide end meeting button for participants
                    this.endMeetingBtn.style.display = 'none';
                    // Show leave button for participants
                    this.leaveBtn.style.display = 'flex';
                    // Request to join meeting
                    this.requestToJoin();
                }
            });
            
            if (this.isHost) {
                this.peer.on('connection', (conn) => {
                    // Don't automatically handle connections, wait for approval
                    conn.on('data', (data) => {
                        if (data.type === 'join-request') {
                            this.handleJoinRequest(conn, data);
                        }
                    });
                });
            }
            
        } catch (error) {
            console.error('Error initializing meeting:', error);
            this.showToast('Unable to access camera/microphone', 'error');
        }
    }
    
    async getHostIp() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            this.hostIp.textContent = data.ip;
            this.hostIpDisplay.classList.remove('hidden');
        } catch (error) {
            console.error('Error getting IP address:', error);
            this.hostIp.textContent = 'Unknown';
            this.hostIpDisplay.classList.remove('hidden');
        }
    }
    
    requestToJoin() {
        // Connect to host to send join request
        const conn = this.peer.connect(this.meetingId);
        
        conn.on('open', () => {
            // Send join request
            conn.send({
                type: 'join-request',
                name: this.userName,
                peerId: this.peer.id
            });
            
            // Show waiting modal
            this.waitingModal.classList.remove('hidden');
            
            // Handle response
            conn.on('data', (data) => {
                if (data.type === 'join-response') {
                    if (data.approved) {
                        this.waitingModal.classList.add('hidden');
                        this.connectToMeeting();
                    } else {
                        this.waitingModal.classList.add('hidden');
                        this.showToast('Your request to join was declined', 'error');
                        setTimeout(() => {
                            window.location.href = 'index.html'; // Redirect to index page
                        }, 2000);
                    }
                }
            });
        });
    }
    
    handleJoinRequest(conn, data) {
        // Store the connection and request data
        this.pendingRequests[data.peerId] = {
            conn: conn,
            name: data.name,
            peerId: data.peerId
        };
        
        // Add to waiting list
        this.addWaitingParticipant(data.peerId, data.name);
        
        // Show notification
        this.showToast(`${data.name} is requesting to join the meeting`, 'warning');
        
        // If no current request, show modal
        if (!this.currentRequest) {
            this.showJoinRequestModal(data.peerId);
        }
    }
    
    showJoinRequestModal(peerId) {
        const request = this.pendingRequests[peerId];
        if (!request) return;
        
        this.currentRequest = peerId;
        this.requesterName.textContent = request.name;
        this.requestMeetingId.textContent = this.meetingId;
        this.joinRequestModal.classList.remove('hidden');
    }
    
    acceptJoinRequest() {
        if (!this.currentRequest) return;
        
        const request = this.pendingRequests[this.currentRequest];
        if (!request) return;
        
        // Send approval
        request.conn.send({
            type: 'join-response',
            approved: true
        });
        
        // Handle the connection
        this.handlePeerConnection(request.conn);
        
        // Wait for the call
        this.peer.on('call', (call) => {
            if (call.peer === this.currentRequest) {
                call.answer(this.localStream);
                this.handlePeerCall(call);
            }
        });
        
        // Remove from waiting list
        this.removeWaitingParticipant(this.currentRequest);
        
        // Clean up
        delete this.pendingRequests[this.currentRequest];
        this.joinRequestModal.classList.add('hidden');
        
        // Check for next pending request
        const nextRequestId = Object.keys(this.pendingRequests)[0];
        if (nextRequestId) {
            this.showJoinRequestModal(nextRequestId);
        } else {
            this.currentRequest = null;
        }
        
        this.showToast(`${request.name} has joined the meeting`, 'success');
    }
    
    declineJoinRequest() {
        if (!this.currentRequest) return;
        
        const request = this.pendingRequests[this.currentRequest];
        if (!request) return;
        
        // Send rejection
        request.conn.send({
            type: 'join-response',
            approved: false
        });
        
        // Remove from waiting list
        this.removeWaitingParticipant(this.currentRequest);
        
        // Clean up
        delete this.pendingRequests[this.currentRequest];
        this.joinRequestModal.classList.add('hidden');
        
        // Check for next pending request
        const nextRequestId = Object.keys(this.pendingRequests)[0];
        if (nextRequestId) {
            this.showJoinRequestModal(nextRequestId);
        } else {
            this.currentRequest = null;
        }
    }
    
    cancelJoinRequest() {
        this.waitingModal.classList.add('hidden');
        window.location.href = 'index.html'; // Redirect to index page
    }
    
    connectToMeeting() {
        // Connect to host
        const conn = this.peer.connect(this.meetingId);
        this.handlePeerConnection(conn);
        
        // Call host with our stream
        const call = this.peer.call(this.meetingId, this.localStream);
        this.handlePeerCall(call);
    }
    
    handlePeerConnection(conn) {
        conn.on('open', () => {
            this.peers[conn.peer] = conn;
            
            // Send user info
            conn.send({
                type: 'user-info',
                name: this.userName,
                isHost: this.isHost
            });
            
            // Handle messages
            conn.on('data', (data) => {
                this.handlePeerData(data, conn.peer);
            });
            
            conn.on('close', () => {
                this.removePeer(conn.peer);
            });
        });
    }
    
    handlePeerCall(call) {
        call.on('stream', (remoteStream) => {
            this.addRemoteVideo(call.peer, remoteStream);
        });
        
        call.on('close', () => {
            this.removePeer(call.peer);
        });
    }
    
    handlePeerData(data, peerId) {
        switch (data.type) {
            case 'user-info':
                this.peersInfo[peerId] = {
                    name: data.name,
                    isHost: data.isHost
                };
                this.updateParticipantName(peerId, data.name);
                if (this.isHost) {
                    this.addParticipantToManagement(peerId, data.name);
                }
                break;
            case 'chat-message':
                this.displayChatMessage(data.name, data.message, false);
                break;
            case 'host-action':
                if (data.action === 'mute') {
                    this.forceMute();
                } else if (data.action === 'kick') {
                    this.forceKick();
                }
                break;
            case 'meeting-ended':
                this.showToast('The host has ended the meeting', 'warning');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
                break;
            case 'audio-toggle':
                this.updatePeerAudioStatus(peerId, data.muted);
                break;
            case 'video-toggle':
                this.updatePeerVideoStatus(peerId, data.off);
                break;
        }
    }
    
    addRemoteVideo(peerId, stream) {
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';
        videoWrapper.id = `video-${peerId}`;
        
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = stream;
        
        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';
        
        const name = document.createElement('span');
        name.className = 'participant-name';
        name.textContent = this.peersInfo[peerId]?.name || `Participant ${peerId.slice(-4)}`;
        name.id = `name-${peerId}`;
        
        const controls = document.createElement('div');
        controls.className = 'video-controls';
        
        const micIndicator = document.createElement('span');
        micIndicator.className = 'mic-indicator hidden';
        micIndicator.id = `mic-${peerId}`;
        micIndicator.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        
        const videoIndicator = document.createElement('span');
        videoIndicator.className = 'video-indicator hidden';
        videoIndicator.id = `video-${peerId}`;
        videoIndicator.innerHTML = '<i class="fas fa-video-slash"></i>';
        
        controls.appendChild(micIndicator);
        controls.appendChild(videoIndicator);
        overlay.appendChild(name);
        overlay.appendChild(controls);
        videoWrapper.appendChild(video);
        videoWrapper.appendChild(overlay);
        
        this.videoContainer.appendChild(videoWrapper);
        
        // Add to participants list
        this.addParticipantToList(peerId, name.textContent);
        
        // Update count
        this.updateParticipantCount();
    }
    
    removePeer(peerId) {
        // Remove video element
        const videoElement = document.getElementById(`video-${peerId}`);
        if (videoElement) {
            videoElement.remove();
        }
        
        // Remove from participants list
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            participantItem.remove();
        }
        
        // Remove from management list (host only)
        const managementItem = document.getElementById(`manage-${peerId}`);
        if (managementItem) {
            managementItem.remove();
        }
        
        // Clean up peer connection and info
        if (this.peers[peerId]) {
            this.peers[peerId].close();
            delete this.peers[peerId];
        }
        if (this.peersInfo[peerId]) {
            delete this.peersInfo[peerId];
        }
        
        this.updateParticipantCount();
        this.showToast('Participant left the meeting', 'info');
    }
    
    updateParticipantName(peerId, name) {
        const nameElement = document.getElementById(`name-${peerId}`);
        if (nameElement) {
            nameElement.textContent = name;
        }
        
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            participantItem.querySelector('span').textContent = name;
        }
    }
    
    updatePeerAudioStatus(peerId, muted) {
        const indicator = document.getElementById(`mic-${peerId}`);
        if (indicator) {
            indicator.style.display = muted ? 'block' : 'none';
        }
        
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            const micIcon = participantItem.querySelector('.participant-status .fa-microphone, .participant-status .fa-microphone-slash');
            if (micIcon) {
                micIcon.className = muted ? 'fas fa-microphone-slash muted' : 'fas fa-microphone';
            }
        }
    }
    
    updatePeerVideoStatus(peerId, off) {
        const indicator = document.getElementById(`video-${peerId}`);
        if (indicator) {
            indicator.style.display = off ? 'block' : 'none';
        }
        
        const participantItem = document.getElementById(`participant-${peerId}`);
        if (participantItem) {
            const videoIcon = participantItem.querySelector('.participant-status .fa-video, .participant-status .fa-video-slash');
            if (videoIcon) {
                videoIcon.className = off ? 'fas fa-video-slash muted' : 'fas fa-video';
            }
        }
    }
    
    addParticipantToList(peerId, name) {
        const participantItem = document.createElement('div');
        participantItem.className = 'participant-item';
        participantItem.id = `participant-${peerId}`;
        
        participantItem.innerHTML = `
            <i class="fas fa-user"></i>
            <span>${name}</span>
            <div class="participant-status">
                <i class="fas fa-microphone"></i>
                <i class="fas fa-video"></i>
            </div>
        `;
        
        this.participantsList.appendChild(participantItem);
    }
    
    addParticipantToManagement(peerId, name) {
        const managementItem = document.createElement('div');
        managementItem.className = 'management-item';
        managementItem.id = `manage-${peerId}`;
        
        managementItem.innerHTML = `
            <div class="participant-info">
                <i class="fas fa-user"></i>
                <span class="participant-name">${name}</span>
            </div>
            <div class="participant-actions">
                <button class="action-btn mute-btn" onclick="app.muteParticipant('${peerId}')">
                    <i class="fas fa-microphone-slash"></i> Mute
                </button>
                <button class="action-btn kick-btn" onclick="app.kickParticipant('${peerId}')">
                    <i class="fas fa-user-times"></i> Kick
                </button>
            </div>
        `;
        
        this.participantsManagement.appendChild(managementItem);
    }
    
    addWaitingParticipant(peerId, name) {
        const waitingItem = document.createElement('div');
        waitingItem.className = 'waiting-item';
        waitingItem.id = `waiting-${peerId}`;
        
        waitingItem.innerHTML = `
            <div class="waiting-info">
                <i class="fas fa-user-clock"></i>
                <span>${name}</span>
            </div>
            <div class="waiting-actions">
                <button class="btn-accept" onclick="app.acceptWaitingParticipant('${peerId}')">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn-decline" onclick="app.declineWaitingParticipant('${peerId}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        this.waitingParticipants.appendChild(waitingItem);
    }
    
    removeWaitingParticipant(peerId) {
        const waitingItem = document.getElementById(`waiting-${peerId}`);
        if (waitingItem) {
            waitingItem.remove();
        }
    }
    
    acceptWaitingParticipant(peerId) {
        if (this.currentRequest && this.currentRequest !== peerId) {
            // If there's already a request being processed, just show this one
            this.joinRequestModal.classList.add('hidden');
            this.showJoinRequestModal(peerId);
        } else {
            this.currentRequest = peerId;
            this.showJoinRequestModal(peerId);
        }
    }
    
    declineWaitingParticipant(peerId) {
        const request = this.pendingRequests[peerId];
        if (!request) return;
        
        // Send rejection
        request.conn.send({
            type: 'join-response',
            approved: false
        });
        
        // Remove from waiting list
        this.removeWaitingParticipant(peerId);
        
        // Clean up
        delete this.pendingRequests[peerId];
        
        // If this was the current request, close modal and check for next
        if (this.currentRequest === peerId) {
            this.joinRequestModal.classList.add('hidden');
            const nextRequestId = Object.keys(this.pendingRequests)[0];
            if (nextRequestId) {
                this.showJoinRequestModal(nextRequestId);
            } else {
                this.currentRequest = null;
            }
        }
    }
    
    muteParticipant(peerId) {
        if (this.peers[peerId]) {
            this.peers[peerId].send({
                type: 'host-action',
                action: 'mute'
            });
            this.showToast(`Muted ${this.peersInfo[peerId]?.name || 'participant'}`, 'warning');
        }
    }
    
    kickParticipant(peerId) {
        if (confirm(`Are you sure you want to kick ${this.peersInfo[peerId]?.name || 'this participant'}?`)) {
            if (this.peers[peerId]) {
                this.peers[peerId].send({
                    type: 'host-action',
                    action: 'kick'
                });
                // Close connection
                this.peers[peerId].close();
                this.removePeer(peerId);
                this.showToast(`Kicked ${this.peersInfo[peerId]?.name || 'participant'}`, 'warning');
            }
        }
    }
    
    forceMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = false;
                this.isMuted = true;
                this.micBtn.classList.remove('active');
                const indicator = document.getElementById('localMicIndicator');
                indicator.style.display = 'block';
                this.showToast('You have been muted by the host', 'warning');
            }
        }
    }
    
    forceKick() {
        this.showToast('You have been removed from the meeting', 'error');
        setTimeout(() => {
            window.location.href = 'index.html'; // Redirect to index page
        }, 2000);
    }
    
    updateParticipantCount() {
        const count = Object.keys(this.peers).length + 1;
        this.participantCount.textContent = count;
    }
    
    toggleMic() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                this.micBtn.classList.toggle('active');
                
                const indicator = document.getElementById('localMicIndicator');
                indicator.style.display = this.isMuted ? 'block' : 'none';
                
                // Update local participant status
                const localStatus = document.querySelector('.participant-item:first-child .participant-status .fa-microphone, .participant-item:first-child .participant-status .fa-microphone-slash');
                if (localStatus) {
                    localStatus.className = this.isMuted ? 'fas fa-microphone-slash muted' : 'fas fa-microphone';
                }
                
                // Notify others
                this.broadcastToPeers({
                    type: 'audio-toggle',
                    muted: this.isMuted
                });
            }
        }
    }
    
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isVideoOff = !videoTrack.enabled;
                this.videoBtn.classList.toggle('active');
                
                const indicator = document.getElementById('localVideoIndicator');
                indicator.style.display = this.isVideoOff ? 'block' : 'none';
                
                // Update local participant status
                const localStatus = document.querySelector('.participant-item:first-child .participant-status .fa-video, .participant-item:first-child .participant-status .fa-video-slash');
                if (localStatus) {
                    localStatus.className = this.isVideoOff ? 'fas fa-video-slash muted' : 'fas fa-video';
                }
                
                // Notify others
                this.broadcastToPeers({
                    type: 'video-toggle',
                    off: this.isVideoOff
                });
            }
        }
    }
    
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true
                });
                
                // Replace video track with screen share
                const videoTrack = screenStream.getVideoTracks()[0];
                
                // Update local video
                this.localVideo.srcObject = screenStream;
                
                // Notify peers
                Object.values(this.peers).forEach(peer => {
                    const call = this.peer.call(peer.peer, screenStream);
                });
                
                this.isScreenSharing = true;
                this.screenShareBtn.classList.add('active');
                
                // Stop sharing when user ends it
                videoTrack.onended = () => {
                    this.stopScreenShare();
                };
                
                this.showToast('Screen sharing started', 'success');
            } catch (error) {
                console.error('Error sharing screen:', error);
                this.showToast('Failed to share screen', 'error');
            }
        } else {
            this.stopScreenShare();
        }
    }
    
    stopScreenShare() {
        // Restore camera
        this.localVideo.srcObject = this.localStream;
        this.isScreenSharing = false;
        this.screenShareBtn.classList.remove('active');
        this.showToast('Screen sharing stopped', 'info');
    }
    
    showPanel(panel) {
        this.sidebar.classList.remove('hidden');
        
        // Hide all panels first
        this.participantsPanel.classList.add('hidden');
        this.securityPanel.classList.add('hidden');
        this.chatPanel.classList.add('hidden');
        
        // Show selected panel
        if (panel === 'participants') {
            this.participantsPanel.classList.remove('hidden');
        } else if (panel === 'security') {
            this.securityPanel.classList.remove('hidden');
        } else if (panel === 'chat') {
            this.chatPanel.classList.remove('hidden');
            document.getElementById('chatBadge').classList.add('hidden');
        }
    }
    
    hideSidebar() {
        this.sidebar.classList.add('hidden');
    }
    
    sendMessage() {
        const message = this.chatInput.value.trim();
        if (message) {
            // Display local message
            this.displayChatMessage(this.userName, message, true);
            
            // Send to peers
            this.broadcastToPeers({
                type: 'chat-message',
                name: this.userName,
                message: message
            });
            
            this.chatInput.value = '';
        }
    }
    
    displayChatMessage(sender, message, isSelf) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${isSelf ? 'self' : ''}`;
        
        messageElement.innerHTML = `
            <div class="sender">${sender}</div>
            <div class="content">${message}</div>
        `;
        
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        // Show badge if chat is not visible
        if (this.chatPanel.classList.contains('hidden')) {
            const badge = document.getElementById('chatBadge');
            badge.classList.remove('hidden');
            badge.textContent = parseInt(badge.textContent || '0') + 1;
        }
    }
    
    broadcastToPeers(data) {
        Object.values(this.peers).forEach(peer => {
            peer.send(data);
        });
    }
    
    leaveMeeting() {
        if (confirm('Are you sure you want to leave the meeting?')) {
            // Close all peer connections
            Object.values(this.peers).forEach(peer => {
                peer.close();
            });
            
            // Close peer
            if (this.peer) {
                this.peer.destroy();
            }
            
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            // Redirect to index page
            window.location.href = 'index.html';
        }
    }
    
    endMeeting() {
        if (confirm('Are you sure you want to end the meeting for everyone?')) {
            // Notify all participants that the meeting is ending
            this.broadcastToPeers({
                type: 'meeting-ended'
            });
            
            // Close all peer connections
            Object.values(this.peers).forEach(peer => {
                peer.close();
            });
            
            // Close peer
            if (this.peer) {
                this.peer.destroy();
            }
            
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            // Redirect to index page
            window.location.href = 'index.html';
        }
    }
    
    generateMeetingId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < 10; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }
    
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        this.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new VideoMeetingApp();
});