select question_code, answer_label
from {{ ref('indicator_answer_catalog') }}
group by question_code, answer_label
having count(*) > 1
