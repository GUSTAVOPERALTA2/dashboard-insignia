// app.js - Dashboard Vicebot Frontend (CON AUTENTICACIÓN)

(function() {
  'use strict';

  // ════════════════════════════════════════════════════
  // AUTENTICACIÓN
  // ════════════════════════════════════════════════════

  function getAuthToken() {
    return localStorage.getItem('auth_token');
  }

  function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    window.location.href = '/login.html';
  }

  // Exponer logout globalmente para el botón
  window.logout = logout;

  // ════════════════════════════════════════════════════
  // AUTO-LOGOUT POR INACTIVIDAD (5 minutos)
  // ════════════════════════════════════════════════════
  
  const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutos
  let inactivityTimer = null;

  function resetInactivityTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    
    inactivityTimer = setTimeout(() => {
      console.log('[AUTH] Session expired due to inactivity');
      alert('Tu sesión ha expirado por inactividad. Inicia sesión nuevamente.');
      logout();
    }, INACTIVITY_TIMEOUT);
  }

  // Detectar actividad del usuario
  if (window.location.pathname !== '/login.html') {
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    activityEvents.forEach(eventName => {
      document.addEventListener(eventName, resetInactivityTimer, true);
    });
    
    // Iniciar timer
    resetInactivityTimer();
  }

  // Verificar autenticación al cargar
  if (window.location.pathname !== '/login.html') {
    const token = getAuthToken();
    
    if (!token) {
      console.log('[AUTH] No token found, redirecting to login');
      window.location.href = '/login.html';
      return; // IMPORTANTE: detener ejecución
    }
    
    // Verificar token
    fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(data => {
      if (!data.valid) {
        console.log('[AUTH] Token invalid, redirecting to login');
        logout();
        return;
      }
      
      // Token válido, guardar datos del usuario
      localStorage.setItem('user_data', JSON.stringify(data.user));
      
      // Mostrar mensaje de bienvenida minimalista
      const userName = document.getElementById('userName');
      if (userName && data.user) {
        // Extraer primer nombre y primer apellido
        const nombreCompleto = data.user.nombre || 'Usuario';
        const nombrePartes = nombreCompleto.split(' ');
        const primerNombre = nombrePartes[0];
        const primerApellido = nombrePartes[1] || '';
        const nombreCorto = primerApellido ? `${primerNombre} ${primerApellido}` : primerNombre;
        
        const cargo = data.user.cargo || '';
        
        // Formato: Bienvenido {Nombre} {Apellido} - {Cargo}
        userName.textContent = `Bienvenido ${nombreCorto}${cargo ? ' - ' + cargo : ''}`;
      }
      
      console.log('[AUTH] Logged in as:', data.user.nombre);
    })
    .catch(err => {
      console.error('[AUTH] Verify error:', err);
      logout();
    });
  }

  // Interceptar todas las peticiones fetch para agregar token
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const token = getAuthToken();
    
    if (token) {
      if (!args[1]) args[1] = {};
      if (!args[1].headers) args[1].headers = {};
      
      args[1].headers['Authorization'] = `Bearer ${token}`;
    }
    
    return originalFetch.apply(this, args)
      .then(response => {
        // Si es 401, redirigir a login
        if (response.status === 401) {
          console.log('[AUTH] 401 Unauthorized, logging out');
          logout();
        }
        return response;
      });
  };

  // ════════════════════════════════════════════════════
  // DASHBOARD CODE (resto del código original)
  // ════════════════════════════════════════════════════

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);
  const escapeHtml = s => String(s || '').replace(/[&<>"']/g, m =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[m]);
  
  const statusLabel = (status) => {
    const labels = {
      'open': 'Abierto',
      'in_progress': 'En Progreso',
      'done': 'Completado',
      'canceled': 'Cancelado'
    };
    return labels[status] || status;
  };
  
  const areaLabel = (area) => {
    const labels = {
      'man': 'Mantenimiento',
      'it': 'IT',
      'ama': 'AMA',
      'rs': 'Room Service',
      'seg': 'Seguridad',
      'exp': 'Experiencias'
    };
    return labels[area?.toLowerCase()] || area;
  };

  const tbody = $('#tbody');
  const emptyBox = $('#emptyBox');
  const btnRefresh = $('#btnRefresh');
  const btnPrev = $('#btnPrev');
  const btnNext = $('#btnNext');
  const rangeLbl = $('#rangeLbl');
  const qInput = $('#qInput');
  const areaSel = $('#areaSel');
  const limitSel = $('#limitSel');
  const statusChips = $$('.chip[data-status]');
  const overlay = $('#detailOverlay');
  const detailPanel = $('#detailPanel');
  const btnClose = $('#btnClose');
  const lastSyncEl = $('#lastSync');
  const connStatus = $('#connStatus');

  let state = {
    q: '',
    area: '',
    status: '',
    limit: 50,
    offset: 0
  };

  let currentIncidentId = null;
  let currentFolio = null;

  function buildQuery() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.area) p.set('area', state.area);
    if (state.status) p.set('status', state.status);
    p.set('limit', state.limit);
    p.set('offset', state.offset);
    return p.toString();
  }

  async function fetchIncidents() {
    const res = await fetch(`/api/incidents?${buildQuery()}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function fetchIncidentDetail(id) {
    const res = await fetch(`/api/incidents/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function updateIncidentStatus(id, status) {
    const res = await fetch(`/api/incidents/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function sendComment(id, text) {
    const res = await fetch(`/api/incidents/${encodeURIComponent(id)}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(st) {
    const s = String(st || 'open').toLowerCase();
    const labels = {
      open: 'Abierto',
      in_progress: 'En Progreso',
      done: 'Completado',
      canceled: 'Cancelado'
    };
    const classes = {
      open: 'badge-open',
      in_progress: 'badge-progress',
      done: 'badge-done',
      canceled: 'badge-canceled'
    };
    return `<span class="badge ${classes[s] || 'badge-open'}">${labels[s] || s}</span>`;
  }

  function areaBadge(area) {
    if (!area) return '—';
    const a = String(area).toLowerCase();
    const colors = {
      man: '#3b82f6',
      it: '#8b5cf6',
      ama: '#ec4899',
      rs: '#f59e0b',
      seg: '#ef4444'
    };
    const color = colors[a] || '#6b7280';
    return `<span class="badge" style="background:${color}">${area.toUpperCase()}</span>`;
  }

  function formatReporter(inc) {
    if (inc.origin_display && inc.origin_display !== inc.chat_id) {
      return escapeHtml(inc.origin_display);
    }

    if (inc.origin_name && inc.origin_name !== inc.chat_id && !inc.origin_name.includes('@')) {
      return escapeHtml(inc.origin_name);
    }

    if (inc.events && inc.events.length > 0) {
      for (const evt of inc.events) {
        if (evt.event_type === 'user_reply' || evt.event_type === 'initial_report' || evt.event_type === 'requester_feedback') {
          const payload = evt.payload || {};
          if (payload.author_name || payload.sender_name) {
            let name = payload.author_name || payload.sender_name;
            return escapeHtml(name);
          }
        }
      }
    }

    const chatId = inc.origin_wa || inc.chat_id;
    if (chatId) {
      const match = chatId.match(/^(\d+)@/);
      if (match) {
        const phone = match[1];
        if (phone.length >= 12 && phone.startsWith('52')) {
          const formatted = '+' + phone.slice(0,2) + ' ' + phone.slice(2,5) + ' ' + phone.slice(5,8) + ' ' + phone.slice(8);
          return `<span class="text-muted">${escapeHtml(formatted)}</span>`;
        }
        return `<span class="text-muted">+${escapeHtml(phone)}</span>`;
      }
      return `<span class="text-muted">${escapeHtml(chatId)}</span>`;
    }

    return '—';
  }

  function renderRows(rows) {
    if (!rows || !rows.length) {
      tbody.innerHTML = '';
      emptyBox.classList.remove('hidden');
      emptyBox.textContent = 'No hay incidencias';
      return;
    }
    emptyBox.classList.add('hidden');

    tbody.innerHTML = rows.map(r => `
      <tr data-id="${r.id}" class="row">
        <td>${escapeHtml(r.folio) || '—'}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${areaBadge(r.area_destino)}</td>
        <td>${escapeHtml(r.lugar) || '—'}</td>
        <td class="desc-cell">${escapeHtml(r.descripcion || r.interpretacion || '—')}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr.row').forEach(tr => {
      tr.addEventListener('click', () => openDetail(tr.dataset.id));
    });
  }

  function updatePager(rowsCount) {
    const hasPrev = state.offset > 0;
    const hasNext = rowsCount >= state.limit;
    btnPrev.disabled = !hasPrev;
    btnNext.disabled = !hasNext;
    const start = state.offset + 1;
    const end = state.offset + rowsCount;
    rangeLbl.textContent = rowsCount ? `${start}–${end}` : '—';
  }

  function setLastSync() {
    if (lastSyncEl) {
      lastSyncEl.textContent = new Date().toLocaleTimeString();
    }
  }

  async function refresh() {
    console.log('[UI] Refreshing...');
    try {
      const data = await fetchIncidents();
      console.log('[UI] Got', data.items?.length || 0, 'items');
      const rows = data.items || data.rows || [];
      renderRows(rows);
      updatePager(rows.length);
      setLastSync();
    } catch (e) {
      console.error('[UI] Refresh error:', e);
      tbody.innerHTML = '';
      emptyBox.classList.remove('hidden');
      emptyBox.textContent = 'Error: ' + e.message;
    }
  }

  async function openDetail(id) {
    try {
      const inc = await fetchIncidentDetail(id);
      currentIncidentId = inc.id;
      currentFolio = inc.folio;
      renderDetail(inc);
      overlay.classList.remove('hidden');
    } catch (e) {
      alert('Error cargando detalle: ' + e.message);
    }
  }

  function closeModal() {
    overlay.classList.add('hidden');
    currentIncidentId = null;
    currentFolio = null;
  }

  function updateChatOnly(events, folio) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
      console.warn('[UI] chatMessages element not found');
      return false;
    }
    
    const newHtml = renderChatMessages(events, folio);
    chatMessages.innerHTML = newHtml;
    
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    
    console.log('[UI] Chat updated with', events?.length || 0, 'events');
    return true;
  }

  function updateStatusBadge(status) {
    const statusSelect = document.getElementById('statusSelect');
    if (statusSelect && statusSelect.value !== status) {
      statusSelect.value = status;
    }
    
    const metaP = detailPanel.querySelector('.detail-meta');
    if (metaP) {
      const badgeSpan = metaP.querySelector('.badge');
      if (badgeSpan) {
        const labels = { open: 'Abierto', in_progress: 'En Progreso', done: 'Completado', canceled: 'Cancelado' };
        const classes = { open: 'badge-open', in_progress: 'badge-progress', done: 'badge-done', canceled: 'badge-canceled' };
        badgeSpan.className = `badge ${classes[status] || 'badge-open'}`;
        badgeSpan.textContent = labels[status] || status;
      }
    }
  }

  function renderDetail(inc) {
    const html = `
      <div class="detail-layout">
        <div class="detail-left">
          <div class="detail-header">
            <div>
              <h2>${escapeHtml(inc.folio) || 'Sin folio'}</h2>
              <p class="detail-meta">
                ${areaBadge(inc.area_destino)} ${statusBadge(inc.status)}
                <span class="text-muted">· ${fmtDate(inc.created_at)}</span>
              </p>
            </div>
            <div class="detail-actions">
              <select id="statusSelect" class="form-select">
                <option value="open" ${inc.status === 'open' ? 'selected' : ''}>Abierto</option>
                <option value="in_progress" ${inc.status === 'in_progress' ? 'selected' : ''}>En Progreso</option>
                <option value="done" ${inc.status === 'done' ? 'selected' : ''}>Completado</option>
                <option value="canceled" ${inc.status === 'canceled' ? 'selected' : ''}>Cancelado</option>
              </select>
            </div>
          </div>

          <div class="detail-info">
            <div class="info-row">
              <span class="info-label">Ubicación:</span>
              <span>${escapeHtml(inc.lugar) || '—'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Descripción:</span>
              <span>${escapeHtml(inc.descripcion) || '—'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Reportado por:</span>
              <span>${formatReporter(inc)}</span>
            </div>
          </div>

          ${renderAttachments(inc.attachments)}
        </div>

        <div class="detail-right">
          <div class="chat-container">
            <div class="chat-header">
              <h3>💬 Conversación</h3>
            </div>
            <div class="chat-messages" id="chatMessages">
              ${renderChatMessages(inc.events, inc.folio)}
            </div>
            <div class="chat-input-container">
              <textarea id="commentInput" class="chat-input" placeholder="Escribe un comentario..." rows="2"></textarea>
              <button id="btnSendComment" class="btn btn-primary btn-send">Enviar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    detailPanel.innerHTML = html;

    const chatMessages = $('#chatMessages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    const statusSelect = detailPanel.querySelector('#statusSelect');
    if (statusSelect) {
      statusSelect.addEventListener('change', async () => {
        try {
          await updateIncidentStatus(inc.id, statusSelect.value);
          refresh();
          const updated = await fetchIncidentDetail(inc.id);
          renderDetail(updated);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      });
    }

    const btnSend = $('#btnSendComment');
    const commentInput = $('#commentInput');

    if (btnSend && commentInput) {
      const handleSend = async () => {
        const text = commentInput.value.trim();
        if (!text) return;

        btnSend.disabled = true;
        btnSend.textContent = 'Enviando...';

        try {
          await sendComment(inc.id, text);
          commentInput.value = '';
          
          const updated = await fetchIncidentDetail(inc.id);
          updateChatOnly(updated.events, updated.folio);
        } catch (e) {
          alert('Error enviando comentario: ' + e.message);
        } finally {
          btnSend.disabled = false;
          btnSend.textContent = 'Enviar';
        }
      };

      btnSend.addEventListener('click', handleSend);
      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }
  }

  function renderChatMessages(events, folio) {
    if (!events || !events.length) {
      return '<div class="chat-empty">No hay mensajes aún</div>';
    }

    const messages = events.map(e => {
      const payload = e.payload || {};
      let icon = '';
      let content = '';
      let author = '';
      let side = 'system';

      switch (e.event_type) {
        case 'created':
          icon = '🎫';
          content = `Ticket ${folio} creado`;
          side = 'system';
          break;

        case 'ticket_sent':
        case 'dispatched_to_groups':
          icon = '📤';
          content = `Ticket enviado a grupos`;
          side = 'system';
          break;

        case 'status_change':
          icon = '🔄';
          const from = payload.from || '?';
          const to = payload.to || '?';
          content = `Estado: ${from} → ${to}`;
          side = 'system';
          break;

        case 'group_status_update': {
          icon = '💬';
          content = payload.text || payload.note || 'Actualización desde grupo';
          author = payload.author_name || payload.author || 'Equipo';
          side = 'left';
          break;
        }

        case 'team_feedback':
        case 'group_comment':
        case 'group_note': {
          icon = '💬';
          content = payload.raw_text || payload.text || payload.note || 'Nota del equipo';
          author = payload.author_name || payload.authorDisplay || payload.author || 'Equipo';
          side = 'left';
          break;
        }

        case 'requester_feedback':
          icon = '💬';
          author = 'Solicitante';
          content = payload.raw_text || payload.text || payload.note || 'Mensaje del solicitante';
          side = 'left';
          break;

        case 'initial_report':
        case 'user_reply':
          icon = '💬';
          author = payload.author_name || payload.sender_name || 'Solicitante';
          if (payload.author_role || payload.sender_role) {
            author += ` (${payload.author_role || payload.sender_role})`;
          }
          content = payload.raw_text || payload.note || 'Mensaje del solicitante';
          side = 'left';
          break;

        case 'comment_text': {
          icon = '💬';
          content = payload.text || '';
          const isDash = payload.by === 'dashboard' || payload.source === 'dashboard';
          side = isDash ? 'right' : 'left';
          if (isDash) {
            author = 'Dashboard';
          } else {
            author = payload.author_name || payload.by || '';
            if (payload.author_role) {
              author += ` (${payload.author_role})`;
            }
          }
          break;
        }

        case 'dashboard_comment':
          icon = '💬';
          author = 'Dashboard';
          content = payload.text || '';
          side = 'right';
          break;

        case 'attachment_added':
          icon = '📎';
          content = `Adjunto: ${payload.filename || 'archivo'}`;
          side = 'system';
          break;

        default:
          icon = 'ℹ️';
          content = e.event_type;
          side = 'system';
      }

      if (side === 'system') {
        return `
          <div class="chat-message chat-system">
            <span class="chat-time">${fmtTime(e.created_at)}</span>
            <span class="chat-system-text">${icon} ${escapeHtml(content)}</span>
          </div>
        `;
      }

      return `
        <div class="chat-message chat-${side}">
          <div class="chat-bubble chat-bubble-${side}">
            ${author ? `<div class="chat-author">${escapeHtml(author)}</div>` : ''}
            <div class="chat-text">${escapeHtml(content)}</div>
            <div class="chat-time-inline">${fmtTime(e.created_at)}</div>
          </div>
        </div>
      `;
    }).join('');

    return messages;
  }

  function renderAttachments(attachments) {
    if (!attachments || !attachments.length) return '';

    const items = attachments.map(a => {
      const url = a.url || '';
      const name = a.filename || 'archivo';
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name) ||
                      (a.mimetype && a.mimetype.startsWith('image/'));

      if (isImage && url) {
        return `<a href="${escapeHtml(url)}" target="_blank" class="thumb">
          <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy">
        </a>`;
      }
      return `<a href="${escapeHtml(url)}" target="_blank" class="file-link">📎 ${escapeHtml(name)}</a>`;
    }).join('');

    return `
      <div class="detail-section">
        <h3>Adjuntos (${attachments.length})</h3>
        <div class="gallery">${items}</div>
      </div>
    `;
  }

  let eventSource = null;
  let sseConnected = false;
  let autoRefreshTimer = null;
  const AUTO_REFRESH_INTERVAL = 30000;

  function updateConnStatus(connected) {
    sseConnected = connected;
    if (connStatus) {
      connStatus.className = connected ? 'conn-status conn-live' : 'conn-status conn-polling';
      connStatus.title = connected ? 'Tiempo real activo' : 'Polling cada 30s';
    }
  }

  function connectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    try {
      console.log('[SSE] Connecting...');
      eventSource = new EventSource('/api/events');

      window.eventSource = eventSource;
      eventSource.addEventListener('open', () => {
        console.log('[SSE] Conectado');
        window.dispatchEvent(new Event('sse-connected'));
      });

      eventSource.addEventListener('error', (e) => {
        console.error('[SSE] Error:', e);
        if (eventSource.readyState === 2) {
          window.dispatchEvent(new Event('sse-disconnected'));
        }
      });
      
      eventSource.onopen = () => {
        console.log('[SSE] Connected');
        updateConnStatus(true);
        stopAutoRefresh();
      };

      eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'ping' || data.type === 'connected') {
            return;
          }
          
          console.log('[SSE] Event received:', data.type, data.incidentId || data.folio || '');

          const updateEvents = ['new_incident', 'status_change', 'incident_update', 'new_comment'];
          
          if (updateEvents.includes(data.type)) {
            console.log('[SSE] Processing update event:', data.type);
            
            refresh();

            if (currentIncidentId && !overlay.classList.contains('hidden')) {
              console.log('[SSE] Updating open modal for:', currentFolio || currentIncidentId);
              
              try {
                const updated = await fetchIncidentDetail(currentIncidentId);
                console.log('[SSE] Fetched updated incident, events count:', updated.events?.length);
                
                const chatUpdated = updateChatOnly(updated.events, updated.folio);
                
                if (data.type === 'status_change' && data.status) {
                  updateStatusBadge(data.status);
                }
                
                if (chatUpdated) {
                  console.log('[SSE] Chat updated successfully');
                }
              } catch (err) {
                console.warn('[SSE] Error updating modal:', err.message);
              }
            }
          }
        } catch (e) {
          // Ignorar errores de parsing
        }
      };

      eventSource.onerror = () => {
        console.warn('[SSE] Error, falling back to polling');
        updateConnStatus(false);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        startAutoRefresh();
      };
    } catch (e) {
      console.warn('[SSE] Not available');
      updateConnStatus(false);
      startAutoRefresh();
    }
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    console.log('[AUTO] Starting polling');
    autoRefreshTimer = setInterval(() => {
      if (overlay.classList.contains('hidden')) {
        refresh();
      }
    }, AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  btnRefresh.addEventListener('click', () => {
    console.log('[UI] Manual refresh clicked');
    state.offset = 0;
    refresh();
  });

  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.q = qInput.value.trim();
      state.offset = 0;
      refresh();
    }
  });

  areaSel.addEventListener('change', () => {
    state.area = areaSel.value;
    state.offset = 0;
    refresh();
  });

  limitSel.addEventListener('change', () => {
    state.limit = Number(limitSel.value) || 50;
    state.offset = 0;
    refresh();
  });

  statusChips.forEach(ch => {
    ch.addEventListener('click', () => {
      statusChips.forEach(c => c.classList.remove('is-active'));
      ch.classList.add('is-active');
      state.status = ch.dataset.status || '';
      state.offset = 0;
      refresh();
    });
  });

  btnPrev.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - state.limit);
    refresh();
  });

  btnNext.addEventListener('click', () => {
    state.offset += state.limit;
    refresh();
  });

  btnClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeModal();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    } else {
      refresh();
      connectSSE();
    }
  });

  const btnReports = $('#btnReports');
  const reportsOverlay = $('#reportsOverlay');
  const btnCloseReports = $('#btnCloseReports');
  const reportStartDate = $('#reportStartDate');
  const reportEndDate = $('#reportEndDate');
  const btnPreviewReport = $('#btnPreviewReport');
  const btnGenerateReport = $('#btnGenerateReport');
  const reportsPreview = $('#reportsPreview');
  const reportsStats = $('#reportsStats');
  const reportsPreviewBody = $('#reportsPreviewBody');
  const reportGenerating = $('#reportGenerating');
  const reportSuccess = $('#reportSuccess');

  btnReports?.addEventListener('click', () => {
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    reportEndDate.value = today.toISOString().split('T')[0];
    reportStartDate.value = lastMonth.toISOString().split('T')[0];
    
    reportsPreview.classList.add('hidden');
    reportGenerating.classList.add('hidden');
    reportSuccess.classList.add('hidden');
    
    reportsOverlay.classList.remove('hidden');
  });

  btnCloseReports?.addEventListener('click', () => {
    reportsOverlay.classList.add('hidden');
    reportsPreview.classList.add('hidden');
    reportGenerating.classList.add('hidden');
    reportSuccess.classList.add('hidden');
  });

  reportsOverlay?.addEventListener('click', (e) => {
    if (e.target === reportsOverlay) {
      reportsOverlay.classList.add('hidden');
      reportsPreview.classList.add('hidden');
      reportGenerating.classList.add('hidden');
      reportSuccess.classList.add('hidden');
    }
  });

  function getReportFilters() {
    const areas = Array.from($$('.checkbox-group input[type="checkbox"][value]:checked'))
      .filter(cb => ['man', 'it', 'ama', 'rs', 'seg', 'exp'].includes(cb.value))
      .map(cb => cb.value);
    
    const statuses = Array.from($$('.checkbox-group input[type="checkbox"][value]:checked'))
      .filter(cb => ['open', 'in_progress', 'done', 'canceled'].includes(cb.value))
      .map(cb => cb.value);
    
    return {
      startDate: reportStartDate.value || null,
      endDate: reportEndDate.value || null,
      areas: areas.length > 0 ? areas : null,
      statuses: statuses.length > 0 ? statuses : null
    };
  }

  btnPreviewReport?.addEventListener('click', async () => {
    try {
      const filters = getReportFilters();
      
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.areas) params.set('areas', filters.areas.join(','));
      if (filters.statuses) params.set('statuses', filters.statuses.join(','));
      params.set('limit', '100');
      
      const res = await fetch(`/api/reports/preview?${params}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      
      const data = await res.json();
      
      renderReportStats(data.stats);
      renderReportPreview(data.preview);
      
      reportsPreview.classList.remove('hidden');
      
    } catch (e) {
      console.error('[REPORTS] Preview error:', e);
      alert('Error al generar vista previa: ' + e.message);
    }
  });

  function renderReportStats(stats) {
    const statusLabels = {
      'open': 'Abiertos',
      'in_progress': 'En Progreso',
      'done': 'Completados',
      'canceled': 'Cancelados'
    };
    
    const areaLabels = {
      'man': 'Mantenimiento',
      'it': 'IT',
      'ama': 'AMA',
      'rs': 'Room Service',
      'seg': 'Seguridad',
      'exp': 'Experiencias'
    };
    
    let html = `
      <div class="stat-card">
        <div class="stat-label">Total</div>
        <div class="stat-value">${stats.total || 0}</div>
      </div>
    `;
    
    Object.entries(stats.byStatus || {}).forEach(([status, count]) => {
      html += `
        <div class="stat-card">
          <div class="stat-label">${statusLabels[status] || status}</div>
          <div class="stat-value">${count}</div>
        </div>
      `;
    });
    
    Object.entries(stats.byArea || {}).forEach(([area, count]) => {
      html += `
        <div class="stat-card">
          <div class="stat-label">${areaLabels[area] || area}</div>
          <div class="stat-value">${count}</div>
        </div>
      `;
    });
    
    reportsStats.innerHTML = html;
  }

  function renderReportPreview(preview) {
    if (!preview || preview.length === 0) {
      reportsPreviewBody.innerHTML = `
        <tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted)">
          No hay registros que cumplan los filtros seleccionados
        </td></tr>
      `;
      return;
    }
    
    const rows = preview.map(inc => `
      <tr>
        <td>${escapeHtml(inc.folio)}</td>
        <td>${fmtDate(inc.fecha)}</td>
        <td><span class="badge badge-${inc.estado}">${statusLabel(inc.estado)}</span></td>
        <td>${areaLabel(inc.area)}</td>
        <td>${escapeHtml(inc.lugar)}</td>
        <td class="desc-cell">${escapeHtml(inc.descripcion)}</td>
      </tr>
    `).join('');
    
    reportsPreviewBody.innerHTML = rows;
  }

  btnGenerateReport?.addEventListener('click', async () => {
    try {
      const filters = getReportFilters();
      
      reportsPreview.classList.add('hidden');
      reportSuccess.classList.add('hidden');
      reportGenerating.classList.remove('hidden');
      
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters)
      });
      
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Error desconocido' }));
        throw new Error(error.message || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      
      if (!data.ok || !data.downloadUrl) {
        throw new Error('No se pudo generar el reporte');
      }
      
      reportGenerating.classList.add('hidden');
      reportSuccess.classList.remove('hidden');
      
      console.log('[REPORTS] Report generated:', data.fileName);
      
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.download = data.fileName || data.downloadUrl.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        console.log('[REPORTS] Auto-downloading:', data.fileName);
        
        setTimeout(() => {
          reportSuccess.classList.add('hidden');
        }, 3000);
      }, 500);
      
    } catch (e) {
      console.error('[REPORTS] Generation error:', e);
      reportGenerating.classList.add('hidden');
      reportSuccess.classList.add('hidden');
      alert('❌ Error al generar el reporte: ' + e.message);
    }
  });

  const newIncidentOverlay = $('#newIncidentOverlay');
  const btnNewIncident = $('#btnNewIncident');
  const btnCloseNew = $('#btnCloseNew');
  const btnCancelNew = $('#btnCancelNew');
  const newIncidentForm = $('#newIncidentForm');
  const newRequesterSelect = $('#newRequester');

  async function loadUsersForSelect() {
    try {
      const res = await fetch('/api/users');
      const users = await res.json();
      
      newRequesterSelect.innerHTML = '<option value="">Selecciona un usuario</option>';
      
      Object.entries(users).forEach(([chatId, user]) => {
        const option = document.createElement('option');
        option.value = chatId;
        option.textContent = `${user.nombre || user.name || chatId}${user.cargo ? ` (${user.cargo})` : ''}`;
        newRequesterSelect.appendChild(option);
      });
    } catch (e) {
      console.error('[UI] Error loading users:', e);
      alert('Error cargando usuarios');
    }
  }

  btnNewIncident?.addEventListener('click', async () => {
    await loadUsersForSelect();
    newIncidentOverlay?.classList.remove('hidden');
    document.getElementById('newDescription')?.focus();
  });

  const closeNewModal = () => {
    newIncidentOverlay?.classList.add('hidden');
    newIncidentForm?.reset();
  };

  btnCloseNew?.addEventListener('click', closeNewModal);
  btnCancelNew?.addEventListener('click', closeNewModal);
  
  newIncidentOverlay?.addEventListener('click', (e) => {
    if (e.target === newIncidentOverlay) closeNewModal();
  });

  newIncidentForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const btnSubmit = $('#btnSubmitNew');
    
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Creando...';
    
    try {
      const res = await fetch('/api/incidents/create', {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Error al crear incidencia');
      }
      
      const result = await res.json();
      
      alert(`✅ Incidencia creada: ${result.folio}`);
      closeNewModal();
      refresh();
      
    } catch (err) {
      console.error('[UI] Error creating incident:', err);
      alert('❌ Error: ' + err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Crear Incidencia';
    }
  });

  console.log('[UI] Initializing dashboard...');
  refresh();
  connectSSE();

  setTimeout(() => {
    if (!sseConnected && !autoRefreshTimer) {
      console.log('[AUTO] SSE timeout, starting polling');
      startAutoRefresh();
    }
  }, 5000);

})();