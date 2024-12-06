import {
  describe,
  deps,
  Joi,
  getMainCheckFn, serverConfig,
} from '../../deps';
import {nock} from "../../../helpers/test";
import {mockAiChat, mockAiChatId, mockAiHistoryApiResponse} from "src/__mocks__";

const { server, request, rte } = deps;

// endpoint to test
const endpoint = (id: string = mockAiChatId) => request(server).get(`/ai/assistant/chats/${id}`);

const responseSchema = Joi.object().keys({
  id: Joi.string().required(),
  messages: Joi.array().items(Joi.object({
    type: Joi.string().allow('HumanMessage', 'AiMessage').required(),
    content: Joi.string().required(),
  })),
}).required();

const aiAssistantNock = nock(serverConfig.get('ai').convAiApiUrl)
  .get('/history')
  .reply(200, JSON.stringify(mockAiHistoryApiResponse))

const mainCheckFn = getMainCheckFn(endpoint);

describe('GET /ai/assistant/chats/:id', () => {
  [
    {
      name: 'Should return history with items',
      responseSchema,
      responseBody: mockAiChat,
    },
    {
      name: 'Should return empty history and not fail',
      before: () => {
        aiAssistantNock.get('/history').reply(200, JSON.stringify([]))
      },
      responseSchema,
      responseBody: {
        ...mockAiChat,
        messages: [],
      },
    },
    {
      name: 'Should return Unauthorized error',
      before: () => {
        aiAssistantNock.get('/history').reply(401, { message: 'Unauthorized' })
      },
      statusCode: 401,
      responseBody: {
        statusCode: 401,
        error: 'ConvAiUnauthorized',
        message: 'Request failed with status code 401',
        errorCode: 11301,
      },
    },
  ].map(mainCheckFn);
});
