// app.js - Dashboard Vicebot Frontend (con Chat de Comentarios)

(function() {
  'use strict';

  // ───────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);
  const escapeHtml = s => String(s || '').replace(/[&<>"']/g, m =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[m]);
  
  // Funciones helper para formatear estados y áreas
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

  // ───────────────────────────────────────────────────────────
  // DOM Elements
  // ───────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────
  let state = {
    q: '',
    area: '',
    status: '',
    limit: 50,
    offset: 0
  };

  let currentIncidentId = null;
  let currentFolio = null;

  // ───────────────────────────────────────────────────────────
  // API
  // ───────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────
  // Formatters
  // ───────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────
  // Format Reporter Name
  // ───────────────────────────────────────────────────────────
  /**
   * Formatea el nombre del reportador
   * Prioridad: origin_display > origin_name (si no es chat_id) > eventos > chat_id formateado
   */
  function formatReporter(inc) {
    // 1. Si tenemos origin_display (ya viene formateado del bot)
    if (inc.origin_display && inc.origin_display !== inc.chat_id) {
      return escapeHtml(inc.origin_display);
    }

    // 2. Si tenemos origin_name y NO es el chat_id
    if (inc.origin_name && inc.origin_name !== inc.chat_id && !inc.origin_name.includes('@')) {
      return escapeHtml(inc.origin_name);
    }

    // 3. Buscar en los eventos el primer mensaje del solicitante
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

    // 4. Fallback: formatear el chat_id para hacerlo más legible
    const chatId = inc.origin_wa || inc.chat_id;
    if (chatId) {
      // Si es un número de WhatsApp (ej: 5217751801318@c.us)
      const match = chatId.match(/^(\d+)@/);
      if (match) {
        const phone = match[1];
        // Formatear como número de teléfono mexicano
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

  // ───────────────────────────────────────────────────────────
  // Render Table
  // ───────────────────────────────────────────────────────────
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

    // Click handlers
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

  // ───────────────────────────────────────────────────────────
  // Main Refresh
  // ───────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────
  // Detail Modal with Chat
  // ───────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────
  // Actualizar solo el chat (sin re-renderizar todo el modal)
  // ───────────────────────────────────────────────────────────
  function updateChatOnly(events, folio) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
      console.warn('[UI] chatMessages element not found');
      return false;
    }
    
    const newHtml = renderChatMessages(events, folio);
    chatMessages.innerHTML = newHtml;
    
    // Scroll al final con animación suave
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    
    console.log('[UI] Chat updated with', events?.length || 0, 'events');
    return true;
  }

  // Actualizar el badge de estado en el modal
  function updateStatusBadge(status) {
    const statusSelect = document.getElementById('statusSelect');
    if (statusSelect && statusSelect.value !== status) {
      statusSelect.value = status;
    }
    
    // También actualizar el badge visual
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
        <!-- Panel Izquierdo: Info + Chat -->
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

        <!-- Panel Derecho: Chat -->
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

    // Scroll chat to bottom
    const chatMessages = $('#chatMessages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Status change handler
    const statusSelect = detailPanel.querySelector('#statusSelect');
    if (statusSelect) {
      statusSelect.addEventListener('change', async () => {
        try {
          await updateIncidentStatus(inc.id, statusSelect.value);
          refresh();
          // Recargar el detalle para actualizar el chat
          const updated = await fetchIncidentDetail(inc.id);
          renderDetail(updated);
        } catch (e) {
          alert('Error: ' + e.message);
        }
      });
    }

    // Comment send handler
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
          
          // Recargar solo el chat para ver el nuevo comentario
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

  // ───────────────────────────────────────────────────────────
  // Render Chat Messages
  // ───────────────────────────────────────────────────────────
  function renderChatMessages(events, folio) {
    if (!events || !events.length) {
      return '<div class="chat-empty">No hay mensajes aún</div>';
    }

    const messages = events.map(e => {
      const payload = e.payload || {};
      let icon = '';
      let content = '';
      let author = '';
      let side = 'system'; // 'left', 'right', 'system'

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

        // ✅ Mensajes/actualizaciones desde grupos de WhatsApp
        case 'group_status_update': {
          icon = '💬';
          content = payload.text || payload.note || 'Actualización desde grupo';
          // author_name viene del bot con nombre y cargo (ej: "Gustavo Peralta (IT Auxiliar)")
          author = payload.author_name || payload.author || 'Equipo';
          side = 'left';
          break;
        }

        // ✅ Feedback/notas del equipo desde grupos
        case 'team_feedback':
        case 'group_comment':
        case 'group_note': {
          icon = '💬';
          content = payload.raw_text || payload.text || payload.note || 'Nota del equipo';
          // Intentar obtener el nombre: author_name ya resuelto, o author (que puede ser un @lid)
          // Si es un @lid, el dashboard debería resolverlo, pero por ahora mostramos lo que hay
          author = payload.author_name || payload.authorDisplay || payload.author || 'Equipo';
          side = 'left';
          break;
        }

        // Mensajes del solicitante (respuestas, feedback)
        case 'requester_feedback':
          icon = '💬';
          author = 'Solicitante';
          content = payload.raw_text || payload.text || payload.note || 'Mensaje del solicitante';
          side = 'left';
          break;

        case 'initial_report':
        case 'user_reply':
          icon = '💬';
          // Usar nombre del autor si está disponible
          author = payload.author_name || payload.sender_name || 'Solicitante';
          if (payload.author_role || payload.sender_role) {
            author += ` (${payload.author_role || payload.sender_role})`;
          }
          content = payload.raw_text || payload.note || 'Mensaje del solicitante';
          side = 'left';
          break;

        // ✅ FIX: el bot guarda comentarios como "comment_text"
        case 'comment_text': {
          icon = '💬';
          content = payload.text || '';
          const isDash = payload.by === 'dashboard' || payload.source === 'dashboard';
          side = isDash ? 'right' : 'left';
          // Mostrar nombre del autor si está disponible
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

        // (compatibilidad) si algún día vuelves a emitir dashboard_comment
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

  // ───────────────────────────────────────────────────────────
  // SSE (Server-Sent Events)
  // ───────────────────────────────────────────────────────────
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

      eventSource.onopen = () => {
        console.log('[SSE] Connected');
        updateConnStatus(true);
        stopAutoRefresh();
      };

      eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Ignorar pings y eventos de conexión
          if (data.type === 'ping' || data.type === 'connected') {
            return;
          }
          
          console.log('[SSE] Event received:', data.type, data.incidentId || data.folio || '');

          // Tipos de eventos que requieren actualización
          const updateEvents = ['new_incident', 'status_change', 'incident_update', 'new_comment'];
          
          if (updateEvents.includes(data.type)) {
            console.log('[SSE] Processing update event:', data.type);
            
            // Siempre refrescar la tabla principal
            refresh();

            // Si el modal está abierto, actualizar el chat
            if (currentIncidentId && !overlay.classList.contains('hidden')) {
              console.log('[SSE] Updating open modal for:', currentFolio || currentIncidentId);
              
              try {
                const updated = await fetchIncidentDetail(currentIncidentId);
                console.log('[SSE] Fetched updated incident, events count:', updated.events?.length);
                
                // Actualizar solo el chat (más eficiente y evita parpadeos)
                const chatUpdated = updateChatOnly(updated.events, updated.folio);
                
                // Si cambió el estado, actualizar el badge también
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

  // ───────────────────────────────────────────────────────────
  // Event Listeners
  // ───────────────────────────────────────────────────────────
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

  // Visibility change
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

  // ═══════════════════════════════════════════════════════════════════════════
  // MÓDULO DE REPORTES
  // ═══════════════════════════════════════════════════════════════════════════

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
  const reportDownloadLink = $('#reportDownloadLink');

  // Abrir modal de reportes
  btnReports?.addEventListener('click', () => {
    // Establecer fechas por defecto (último mes)
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    reportEndDate.value = today.toISOString().split('T')[0];
    reportStartDate.value = lastMonth.toISOString().split('T')[0];
    
    // Resetear estado
    reportsPreview.classList.add('hidden');
    reportGenerating.classList.add('hidden');
    reportSuccess.classList.add('hidden');
    
    reportsOverlay.classList.remove('hidden');
  });

  // Cerrar modal de reportes
  btnCloseReports?.addEventListener('click', () => {
    reportsOverlay.classList.add('hidden');
  });

  reportsOverlay?.addEventListener('click', (e) => {
    if (e.target === reportsOverlay) {
      reportsOverlay.classList.add('hidden');
    }
  });

  // Obtener filtros seleccionados
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

  // Vista previa del reporte
  btnPreviewReport?.addEventListener('click', async () => {
    try {
      const filters = getReportFilters();
      
      // Construir query params
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.areas) params.set('areas', filters.areas.join(','));
      if (filters.statuses) params.set('statuses', filters.statuses.join(','));
      params.set('limit', '100');
      
      const res = await fetch(`/api/reports/preview?${params}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      
      const data = await res.json();
      
      // Mostrar estadísticas
      renderReportStats(data.stats);
      
      // Mostrar vista previa
      renderReportPreview(data.preview);
      
      reportsPreview.classList.remove('hidden');
      
    } catch (e) {
      console.error('[REPORTS] Preview error:', e);
      alert('Error al generar vista previa: ' + e.message);
    }
  });

  // Renderizar estadísticas
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
    
    // Estadísticas por estado
    Object.entries(stats.byStatus || {}).forEach(([status, count]) => {
      html += `
        <div class="stat-card">
          <div class="stat-label">${statusLabels[status] || status}</div>
          <div class="stat-value">${count}</div>
        </div>
      `;
    });
    
    // Estadísticas por área
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

  // Renderizar vista previa de tabla
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

  // Generar reporte Excel
  btnGenerateReport?.addEventListener('click', async () => {
    try {
      const filters = getReportFilters();
      
      // Mostrar spinner
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
      
      // Mostrar éxito con link de descarga
      reportGenerating.classList.add('hidden');
      reportSuccess.classList.remove('hidden');
      
      reportDownloadLink.href = data.downloadUrl;
      reportDownloadLink.download = data.fileName;
      
      console.log('[REPORTS] Report generated:', data.fileName);
      
    } catch (e) {
      console.error('[REPORTS] Generation error:', e);
      reportGenerating.classList.add('hidden');
      alert('Error al generar el reporte: ' + e.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════


  // ───────────────────────────────────────────────────────────
  // Init
  // ───────────────────────────────────────────────────────────
  console.log('[UI] Initializing dashboard...');
  refresh();
  connectSSE();

  // Fallback si SSE no conecta
  setTimeout(() => {
    if (!sseConnected && !autoRefreshTimer) {
      console.log('[AUTO] SSE timeout, starting polling');
      startAutoRefresh();
    }
  }, 5000);

})();