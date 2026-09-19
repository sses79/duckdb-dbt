select document_id, question_code
from {{ ref('int_wellbeing_answers') }}
group by document_id, question_code
having count(*) > 1
