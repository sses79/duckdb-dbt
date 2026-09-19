select document_id, question_code
from {{ ref('fct_wellbeing_response') }}
group by document_id, question_code
having count(*) > 1
