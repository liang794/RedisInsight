import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { v4 as uuidv4 } from 'uuid'

import { AxiosError } from 'axios'
import { apiService, localStorageService } from 'uiSrc/services'
import { ApiEndpoints, BrowserStorageItem } from 'uiSrc/constants'
import { AiAgreement, AiChatMessage, StateAiAssistant } from 'uiSrc/slices/interfaces/aiAssistant'
import {
  getApiErrorCode,
  getAxiosError,
  isStatusSuccessful,
  Maybe,
  Nullable,
  parseCustomError
} from 'uiSrc/utils'
import { getBaseUrl } from 'uiSrc/services/apiService'
import { getStreamedAnswer } from 'uiSrc/utils/api'
import ApiStatusCode from 'uiSrc/constants/apiStatusCode'
import { generateAiMessage, generateHumanMessage } from 'uiSrc/utils/transformers/chatbot'
import { logoutUserAction } from 'uiSrc/slices/oauth/cloud'
import { addErrorNotification } from 'uiSrc/slices/app/notifications'
import { EnhancedAxiosError } from 'uiSrc/slices/interfaces'
import { AppDispatch, RootState } from '../store'

export const initialState: StateAiAssistant = {
  ai: {
    loading: false,
    agreementLoading: false,
    agreements: null,
    messages: [],
  },
  hideCopilotSplashScreen: localStorageService.get(BrowserStorageItem.hideCopilotSplashScreen) ?? false,
}

// A slice for recipes
const aiAssistantSlice = createSlice({
  name: 'aiAssistant',
  initialState,
  reducers: {
    setHideCopilotSplashScreen: (state, { payload }: PayloadAction<boolean>) => {
      state.hideCopilotSplashScreen = payload
      localStorageService.set(BrowserStorageItem.hideCopilotSplashScreen, payload)
    },

    getAiAgreements: (state) => {
      state.ai.agreementLoading = true
    },
    getAiAgreementsSuccess: (state, { payload }: PayloadAction<AiAgreement[]>) => {
      state.ai.agreementLoading = false
      state.ai.agreements = payload
    },
    getAiAgreementsFailed: (state) => {
      state.ai.agreementLoading = false
    },

    clearAiAgreements: (state) => {
      state.ai.agreements = []
    },

    updateAiAgreements: (state) => {
      state.ai.agreementLoading = true
    },
    updateAiAgreementsSuccess: (state, { payload }: PayloadAction<AiAgreement[]>) => {
      state.ai.agreementLoading = false
      state.ai.agreements = payload
    },
    updateAiAgreementsFailed: (state) => {
      state.ai.agreementLoading = false
    },

    getAiChatHistory: (state) => {
      state.ai.loading = true
    },
    getAiChatHistorySuccess: (state, { payload }: PayloadAction<Array<AiChatMessage>>) => {
      state.ai.loading = false
      state.ai.messages = payload?.map((m) => ({ ...m, id: `ai_${uuidv4()}` })) || []
    },
    getAiChatHistoryFailed: (state) => {
      state.ai.loading = false
    },
    sendAiQuestion: (state, { payload }: PayloadAction<AiChatMessage>) => {
      state.ai.messages.push(payload)
    },
    setAiQuestionError: (
      state,
      { payload }: PayloadAction<{
        id: string,
        error: Maybe<{
          statusCode: number
          errorCode?: number
          details?: Record<string, any>
        }>
      }>
    ) => {
      state.ai.messages = state.ai.messages.map((item) => (item.id === payload.id ? {
        ...item,
        error: payload.error
      } : item))
    },
    sendAiAnswer: (state, { payload }: PayloadAction<AiChatMessage>) => {
      state.ai.messages.push(payload)
    },
    clearAiChatHistory: (state) => {
      state.ai.messages = []
    },
  }
})

// A selector
export const aiChatSelector = (state: RootState) => state.panels.aiAssistant.ai
export const aiAssistantSelector = (state: RootState) => state.panels.aiAssistant

// Actions generated from the slice
export const {
  getAiAgreements,
  getAiAgreementsSuccess,
  getAiAgreementsFailed,

  updateAiAgreements,
  updateAiAgreementsSuccess,
  updateAiAgreementsFailed,

  getAiChatHistory,
  getAiChatHistorySuccess,
  getAiChatHistoryFailed,

  sendAiQuestion,
  setAiQuestionError,
  sendAiAnswer,
  clearAiAgreements,
  clearAiChatHistory,
  setHideCopilotSplashScreen,
} = aiAssistantSlice.actions

// The reducer
export default aiAssistantSlice.reducer

export function getAiAgreementsAction(onSuccess?: () => void, onFailure?: () => void) {
  return async (dispatch: AppDispatch) => {
    dispatch(getAiAgreements())

    try {
      const { status, data } = await apiService.get<any>(`${ApiEndpoints.AI_CHAT}/messages/agreements`)

      if (isStatusSuccessful(status)) {
        dispatch(getAiAgreementsSuccess(data))
      }

      onSuccess?.()
    } catch (error) {
      const err = getAxiosError(error as EnhancedAxiosError)
      const errorCode = getApiErrorCode(error as AxiosError)

      if (errorCode === ApiStatusCode.Unauthorized) {
        dispatch<any>(logoutUserAction())
      }

      dispatch(addErrorNotification(err))
      dispatch(getAiAgreementsFailed())
      onFailure?.()
    }
  }
}

export interface UpdateAiAgreementsInterface {
  general: boolean
  db?: boolean
}

export function updateAiAgreementsAction(
  instanceId: Nullable<string>,
  toUpdate: UpdateAiAgreementsInterface,
  onSuccess?: () => void,
  onFailure?: () => void
) {
  return async (dispatch: AppDispatch) => {
    dispatch(updateAiAgreements())

    try {
      let aiUrl: string = ApiEndpoints.AI_CHAT
      if (instanceId) aiUrl += `/${instanceId}`
      const { status, data } = await apiService.post<any>(`${aiUrl}/messages/agreements`, toUpdate)
      if (isStatusSuccessful(status)) {
        dispatch(updateAiAgreementsSuccess(data))
        onSuccess?.()
      }
    } catch (error) {
      const err = getAxiosError(error as EnhancedAxiosError)
      const errorCode = getApiErrorCode(error as AxiosError)

      if (errorCode === ApiStatusCode.Unauthorized) {
        dispatch<any>(logoutUserAction())
      }

      dispatch(addErrorNotification(err))
      dispatch(updateAiAgreementsFailed())
      onFailure?.()
    }
  }
}

export function getAiChatHistoryAction(instanceId: Nullable<string>, onSuccess?: () => void) {
  return async (dispatch: AppDispatch) => {
    dispatch(getAiChatHistory())

    try {
      let aiUrl: string = ApiEndpoints.AI_CHAT
      if (instanceId) aiUrl += `/${instanceId}`
      const { status, data } = await apiService.get<any>(`${aiUrl}/messages`)

      if (isStatusSuccessful(status)) {
        dispatch(getAiChatHistorySuccess(data))
        onSuccess?.()
      }
    } catch (error) {
      const err = getAxiosError(error as EnhancedAxiosError)
      const errorCode = getApiErrorCode(error as AxiosError)

      if (errorCode === ApiStatusCode.Unauthorized) {
        dispatch<any>(logoutUserAction())
      }

      dispatch(addErrorNotification(err))
      dispatch(getAiChatHistoryFailed())
    }
  }
}

export function askAiChatbotAction(
  databaseId: Nullable<string>,
  message: string,
  { onMessage, onError, onFinish }: {
    onMessage?: (message: AiChatMessage) => void,
    onError?: (errorCode: number) => void,
    onFinish?: () => void
  }
) {
  return async (dispatch: AppDispatch) => {
    const humanMessage = generateHumanMessage(message)
    const aiMessageProgressed: AiChatMessage = generateAiMessage()

    dispatch(sendAiQuestion(humanMessage))

    onMessage?.(aiMessageProgressed)

    const baseUrl = getBaseUrl()
    let aiUrl: string = `${baseUrl}${ApiEndpoints.AI_CHAT}`
    if (databaseId) aiUrl += `/${databaseId}`
    aiUrl += '/messages'

    await getStreamedAnswer(
      aiUrl,
      message,
      {
        onMessage: (value: string) => {
          aiMessageProgressed.content += value
          onMessage?.(aiMessageProgressed)
        },
        onFinish: () => {
          dispatch(sendAiAnswer(aiMessageProgressed))
          onFinish?.()
        },
        onError: (error: any) => {
          if (error?.status === ApiStatusCode.Unauthorized) {
            const err = parseCustomError(error)
            dispatch(addErrorNotification(err))
            dispatch(logoutUserAction())
          } else {
            dispatch(setAiQuestionError({
              id: humanMessage.id,
              error: {
                statusCode: error?.status ?? 500,
                errorCode: error?.errorCode,
                details: error?.details
              }
            }))
          }

          onError?.(error?.status ?? 500)
          onFinish?.()
        }
      }
    )
  }
}

export function removeAiChatHistoryAction(
  databaseId: Nullable<string>,
  onSuccess?: () => void
) {
  return async (dispatch: AppDispatch) => {
    let aiUrl: string = ApiEndpoints.AI_CHAT
    if (databaseId) aiUrl += `/${databaseId}`
    try {
      const { status } = await apiService.delete<any>(`${aiUrl}/messages`)
      if (isStatusSuccessful(status)) {
        dispatch(clearAiChatHistory())
        onSuccess?.()
      }
    } catch (error) {
      const err = getAxiosError(error as EnhancedAxiosError)
      const errorCode = getApiErrorCode(error as AxiosError)

      if (errorCode === ApiStatusCode.Unauthorized) {
        dispatch<any>(logoutUserAction())
      }

      dispatch(addErrorNotification(err))
    }
  }
}
