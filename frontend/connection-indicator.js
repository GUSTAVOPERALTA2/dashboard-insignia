// connection-indicator.js
// Maneja el indicador visual de conexión SSE

(function() {
  // Obtener o crear el indicador
  function getOrCreateIndicator() {
    let indicator = document.getElementById('connection-indicator');
    
    if (!indicator) {
      // Buscar el h1 de "Incidencias"
      const title = document.querySelector('h1');
      if (title) {
        indicator = document.createElement('span');
        indicator.id = 'connection-indicator';
        indicator.className = 'connection-status connecting';
        indicator.title = 'Conectando...';
        title.appendChild(indicator);
      }
    }
    
    return indicator;
  }
  
  // Actualizar estado del indicador
  function setConnectionStatus(status) {
    const indicator = getOrCreateIndicator();
    if (!indicator) return;
    
    // Remover clases previas
    indicator.className = 'connection-status';
    
    switch(status) {
      case 'connected':
        indicator.classList.add('connected');
        indicator.title = 'Conectado - Actualizaciones en tiempo real';
        break;
      case 'disconnected':
        indicator.classList.add('disconnected');
        indicator.title = 'Desconectado - Sin actualizaciones en tiempo real';
        break;
      case 'connecting':
        indicator.classList.add('connecting');
        indicator.title = 'Conectando...';
        break;
    }
    
    console.log('[SSE] Status:', status);
  }
  
  // Monitorear el EventSource del SSE
  let checkInterval;
  
  function startMonitoring() {
    // Verificar cada 2 segundos si hay conexión SSE
    checkInterval = setInterval(() => {
      // Buscar si existe el eventSource global (debe estar en app.js)
      if (window.eventSource) {
        const readyState = window.eventSource.readyState;
        
        if (readyState === 0) {
          setConnectionStatus('connecting');
        } else if (readyState === 1) {
          setConnectionStatus('connected');
        } else if (readyState === 2) {
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('connecting');
      }
    }, 2000);
  }
  
  // Eventos personalizados para control manual
  window.addEventListener('sse-connected', () => setConnectionStatus('connected'));
  window.addEventListener('sse-disconnected', () => setConnectionStatus('disconnected'));
  window.addEventListener('sse-connecting', () => setConnectionStatus('connecting'));
  
  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      getOrCreateIndicator();
      startMonitoring();
    });
  } else {
    getOrCreateIndicator();
    startMonitoring();
  }
  
  // Limpiar al cerrar
  window.addEventListener('beforeunload', () => {
    if (checkInterval) clearInterval(checkInterval);
  });
})();