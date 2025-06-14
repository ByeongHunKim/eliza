import {
  type Action,
  type ActionExample,
  booleanFooter,
  composePromptFromState,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  type State,
  asUUID,
} from '@elizaos/core';
import { v4 } from 'uuid';

/**
 * Template string for deciding if the agent should mute a room and stop responding unless explicitly mentioned.
 *
 * @type {string}
 */
/**
 * Template for deciding if agent should mute a room and stop responding unless explicitly mentioned.
 *
 * @type {string}
 */
export const shouldMuteTemplate = `# Task: Decide if {{agentName}} should mute this room and stop responding unless explicitly mentioned.

{{recentMessages}}

Should {{agentName}} mute this room and stop responding unless explicitly mentioned?

Respond with YES if:
- The user is being aggressive, rude, or inappropriate
- The user has directly asked {{agentName}} to stop responding or be quiet
- {{agentName}}'s responses are not well-received or are annoying the user(s)

Otherwise, respond with NO.
${booleanFooter}`;

/**
 * Action for muting a room, ignoring all messages unless explicitly mentioned.
 * Only do this if explicitly asked to, or if you're annoying people.
 *
 * @name MUTE_ROOM
 * @type {Action}
 *
 * @property {string} name - The name of the action
 * @property {string[]} similes - Similar actions related to muting a room
 * @property {string} description - Description of the action
 * @property {Function} validate - Validation function to check if the room is not already muted
 * @property {Function} handler - Handler function to handle muting the room
 * @property {ActionExample[][]} examples - Examples of using the action
 */
export const muteRoomAction: Action = {
  name: 'MUTE_ROOM',
  similes: ['MUTE_CHAT', 'MUTE_CONVERSATION', 'MUTE_ROOM', 'MUTE_THREAD', 'MUTE_CHANNEL'],
  description:
    "Mutes a room, ignoring all messages unless explicitly mentioned. Only do this if explicitly asked to, or if you're annoying people.",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const roomId = message.roomId;
    const roomState = await runtime.getParticipantUserState(roomId, runtime.agentId);
    return roomState !== 'MUTED';
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: { [key: string]: unknown },
    _callback?: HandlerCallback,
    responses?: Memory[]
  ) => {
    if (!state) {
      logger.error('State is required for muting a room');
      throw new Error('State is required for muting a room');
    }

    async function _shouldMute(state: State): Promise<boolean> {
      const shouldMutePrompt = composePromptFromState({
        state,
        template: shouldMuteTemplate, // Define this template separately
      });

      const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        runtime,
        prompt: shouldMutePrompt,
        stopSequences: [],
      });

      const cleanedResponse = response.trim().toLowerCase();

      // Handle various affirmative responses
      if (
        cleanedResponse === 'true' ||
        cleanedResponse === 'yes' ||
        cleanedResponse === 'y' ||
        cleanedResponse.includes('true') ||
        cleanedResponse.includes('yes')
      ) {
        await runtime.createMemory(
          {
            entityId: message.entityId,
            agentId: message.agentId,
            roomId: message.roomId,
            content: {
              source: message.content.source,
              thought: 'I will now mute this room',
              actions: ['MUTE_ROOM_STARTED'],
            },
            metadata: {
              type: 'MUTE_ROOM',
            },
          },
          'messages'
        );
        return true;
      }

      // Handle various negative responses
      if (
        cleanedResponse === 'false' ||
        cleanedResponse === 'no' ||
        cleanedResponse === 'n' ||
        cleanedResponse.includes('false') ||
        cleanedResponse.includes('no')
      ) {
        await runtime.createMemory(
          {
            entityId: message.entityId,
            agentId: message.agentId,
            roomId: message.roomId,
            content: {
              source: message.content.source,
              thought: 'I decided to not mute this room',
              actions: ['MUTE_ROOM_FAILED'],
            },
            metadata: {
              type: 'MUTE_ROOM',
            },
          },
          'messages'
        );
      }

      // Default to false if response is unclear
      logger.warn(`Unclear boolean response: ${response}, defaulting to false`);
      return false;
    }

    if (await _shouldMute(state)) {
      await runtime.setParticipantUserState(message.roomId, runtime.agentId, 'MUTED');
    }

    const room = state.data.room ?? (await runtime.getRoom(message.roomId));

    await runtime.createMemory(
      {
        entityId: message.entityId,
        agentId: message.agentId,
        roomId: message.roomId,
        content: {
          thought: `I muted the room ${room.name}`,
          actions: ['MUTE_ROOM_START'],
        },
      },
      'messages'
    );

    // Push a response message to responses array
    const muteMessage = {
      id: asUUID(v4()),
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      content: {
        text: '', // Empty text since this is just an action
        thought: `I muted the room ${room.name}`,
        actions: ['MUTE_ROOM'],
        source: message.content.source,
      },
      roomId: message.roomId,
      createdAt: Date.now(),
    };

    await runtime.createMemory(muteMessage, 'messages');
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: '{{name3}}, please mute this channel. No need to respond here for now.',
        },
      },
      {
        name: '{{name3}}',
        content: {
          text: 'Got it',
          actions: ['MUTE_ROOM'],
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '@{{name1}} we could really use your input on this',
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: '{{name3}}, please mute this channel for the time being',
        },
      },
      {
        name: '{{name3}}',
        content: {
          text: 'Understood',
          actions: ['MUTE_ROOM'],
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Hey what do you think about this new design',
        },
      },
      {
        name: '{{name3}}',
        content: {
          text: '',
          actions: ['IGNORE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: '{{name2}} plz mute this room',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'np going silent',
          actions: ['MUTE_ROOM'],
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'whos going to the webxr meetup in an hour btw',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: '',
          actions: ['IGNORE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'too many messages here {{name2}}',
        },
      },
      {
        name: '{{name1}}',
        content: {
          text: 'my bad ill mute',
          actions: ['MUTE_ROOM'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'yo {{name2}} dont talk in here',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'sry',
          actions: ['MUTE_ROOM'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;
