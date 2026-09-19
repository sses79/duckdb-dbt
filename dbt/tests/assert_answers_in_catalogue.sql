select a.document_id, a.question_code, a.answer_label
from {{ ref('int_wellbeing_answers') }} as a
left join {{ ref('indicator_answer_catalog') }} as c
    on a.question_code = c.question_code
    and a.answer_label = c.answer_label
where a.answer_label is not null
    and c.question_code is null
