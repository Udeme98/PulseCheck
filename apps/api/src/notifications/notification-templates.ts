interface IncidentEmailData {
  monitorName: string;
  monitorUrl: string;
  eventTime: string;
}

export function incidentOpenedTemplate(data: IncidentEmailData) {
  const eventTime = new Date(data.eventTime).toUTCString();

  return {
    subject: `Incident detected: ${data.monitorName} is DOWN`,
    text: `
Your monitor is DOWN.

Monitor: ${data.monitorName}
URL: ${data.monitorUrl}
Detected at: ${eventTime}

PulseCheck detected repeated failures from your monitored endpoint.
    `.trim(),
    html: `
      <h2>Monitor is DOWN</h2>
      <p>PulseCheck detected repeated failures from your monitored endpoint.</p>
      <p><strong>Monitor:</strong> ${escapeHtml(data.monitorName)}</p>
      <p><strong>URL:</strong> <a href="${escapeHtml(data.monitorUrl)}">${escapeHtml(data.monitorUrl)}</a></p>
      <p><strong>Detected at:</strong> ${escapeHtml(eventTime)}</p>
    `,
  };
}

export function incidentResolvedTemplate(data: IncidentEmailData) {
  const eventTime = new Date(data.eventTime).toUTCString();

  return {
    subject: `Incident resolved: ${data.monitorName} is UP`,
    text: `
Your monitor has recovered.

Monitor: ${data.monitorName}
URL: ${data.monitorUrl}
Recovered at: ${eventTime}

PulseCheck detected that your monitored endpoint is responding again.
    `.trim(),
    html: `
      <h2>Monitor is back UP</h2>
      <p>PulseCheck detected that your monitored endpoint is responding again.</p>
      <p><strong>Monitor:</strong> ${escapeHtml(data.monitorName)}</p>
      <p><strong>URL:</strong> <a href="${escapeHtml(data.monitorUrl)}">${escapeHtml(data.monitorUrl)}</a></p>
      <p><strong>Recovered at:</strong> ${escapeHtml(eventTime)}</p>
    `,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}
