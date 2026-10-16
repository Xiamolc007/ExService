import { api } from '../../../api/client'
import type { FeedbackPort } from './flow'

export const feedbackPort: FeedbackPort = {
  prepare: body=>api.POST('/support/feedback/submissions',{body,alert:false,timeout:15000}),
  get: submissionId=>api.GET('/support/feedback/submissions/{submissionId}',{params:{path:{submissionId}},alert:false,timeout:15000}),
  lookup: submissionKey=>api.GET('/support/feedback/submissions/lookup',{params:{query:{submissionKey}},alert:false,timeout:15000}),
  upload: (submissionId,attachmentId,file)=> {
    const body=new FormData(); body.append('file',file,file.name)
    return api.PUT('/support/feedback/submissions/{submissionId}/attachments/{attachmentId}',{params:{path:{submissionId,attachmentId}},body,alert:false,timeout:130000})
  },
  advance:(submissionId,body)=>api.POST('/support/feedback/submissions/{submissionId}/advance',{params:{path:{submissionId}},body,alert:false,timeout:95000}),
}
export const getFeedbackOptions=(area: 'development' | 'community' = 'development')=>api.GET('/support/feedback/options',{params:{query:{area}},alert:false,timeout:15000})
