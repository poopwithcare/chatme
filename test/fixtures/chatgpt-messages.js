// Faithful reconstruction of the real /backend-api/conversations/<id>/messages
// shape, trimmed to the message kinds that matter.
const entry = (url, title) => ({ type: 'search_result', url, title, snippet: '', ref_id: { turn_index: 572624, ref_type: 'search', ref_index: 0 }, pub_date: null, attribution: 'x' });
const payload = {
  messages: [
    { id: 'sys1', author: { role: 'system', name: null, metadata: {} }, create_time: 1790997773.481928,
      content: { content_type: 'text', parts: [''] }, status: 'finished_successfully', weight: 0,
      metadata: { is_visually_hidden_from_conversation: true, can_save: false }, recipient: 'all', channel: null },

    { id: 'u1', author: { role: 'user', name: null, metadata: {} }, create_time: 1790997773.021,
      content: { content_type: 'text', parts: ['im trying to figure out the mathmatical thing'] },
      status: 'finished_successfully', weight: 1, metadata: { can_save: false }, recipient: 'all', channel: null },

    { id: 'a1t', author: { role: 'assistant', name: null, metadata: {} }, create_time: 1790997777.073299,
      content: { content_type: 'thoughts', thoughts: [{ summary: 'Clarifying the topology', content: 'secret reasoning', chunks: [], finished: true }], source_analysis_msg_id: 'x' },
      status: 'finished_successfully', weight: 1, metadata: { reasoning_status: 'is_reasoning' }, recipient: 'all', channel: null },

    { id: 'a1p', author: { role: 'assistant', name: null, metadata: {} }, create_time: 1790997777.997415,
      content: { content_type: 'text', parts: ['I think you are describing a **hybrid graph**.'] },
      status: 'finished_successfully', weight: 1, metadata: { is_thinking_preamble_message: true }, recipient: 'all', channel: 'commentary' },

    { id: 'a1s', author: { role: 'assistant', name: null, metadata: {} }, create_time: 1790997778.142792,
      content: { content_type: 'text', parts: [''] }, status: 'finished_successfully', weight: 1,
      metadata: { is_complete: true, tool_icons: ['globe'] }, recipient: 'web.run', channel: null },

    { id: 't1', author: { role: 'tool', name: 'web.run', metadata: { real_author: 'tool:web.run' } }, create_time: 1790997778.23966,
      content: { content_type: 'text', parts: [''] }, status: 'finished_successfully', weight: 1,
      metadata: { search_model_queries: { type: 'search_model_queries', queries: ['"polar grid graph" graph theory', '"mesh of trees" network topology'] },
        search_result_groups: [{ type: 'search_result_group', domain: 'en.wikipedia.org', entries: [entry('https://en.wikipedia.org/wiki/Network_topology', 'Network topology')] }] },
      recipient: 'all', channel: null },

    { id: 'a1r', author: { role: 'assistant', name: null, metadata: {} }, create_time: 1790997781.434184,
      content: { content_type: 'reasoning_recap', content: 'Worked for 7s' },
      status: 'finished_successfully', weight: 1, metadata: { reasoning_recap_type: 'collapse' }, recipient: 'all', channel: null },

    { id: 'a1f', author: { role: 'assistant', name: null, metadata: {} }, create_time: 1790997781.43794,
      content: { content_type: 'text', parts: ['Yes - there are two structures overlapping. citeturn572624search47'] },
      status: 'finished_successfully', end_turn: true, weight: 1,
      metadata: { is_complete: true,
        content_references: [{ matched_text: 'cite', start_idx: 40, end_idx: 60, safe_urls: ['https://en.wikipedia.org/wiki/Network_topology'],
          items: [{ title: 'Network topology', url: 'https://en.wikipedia.org/wiki/Network_topology?utm_source=chatgpt.com', attribution: 'Wikipedia' }],
          sources: [{ title: 'Network topology', url: 'https://en.wikipedia.org/wiki/Network_topology' }], type: 'grouped_webpages' }],
        search_result_groups: [{ type: 'search_result_group', domain: 'aws.amazon.com', entries: [entry('https://aws.amazon.com/what-is/network-topology/', 'What Is Network Topology')] }] },
      recipient: 'all', channel: 'final' },

    { id: 'u2', author: { role: 'user', name: null, metadata: {} }, create_time: 1790998138.585,
      content: { content_type: 'text', parts: ['but there is no center C'] }, status: 'finished_successfully', weight: 1,
      metadata: { can_save: false }, recipient: 'all', channel: null },

    { id: 'a2f', author: { role: 'assistant', name: null, metadata: {} }, create_time: 1790998140.779718,
      content: { content_type: 'text', parts: ['Yes - that clarification changes the model.'] }, status: 'finished_successfully', end_turn: true,
      weight: 1, metadata: { is_complete: true, search_result_groups: [] }, recipient: 'all', channel: 'final' }
  ],
  safe_urls: ['https://en.wikipedia.org/wiki/Network_topology'],
  blocked_urls: [],
  page_info: { start_cursor: 'sys1', end_cursor: 'a2f', has_previous_page: false, has_next_page: true }
};
module.exports = { CHATGPT_MESSAGES_FIXTURE: payload };
