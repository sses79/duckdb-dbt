select question_code
from {{ ref('indicator_answer_catalog') }}
group by question_code
having min(answer_order) <> 1
   or max(answer_order) <> count(*)
   or count(distinct answer_order) <> count(*)
